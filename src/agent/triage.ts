import { generateText, type LanguageModel, stepCountIs } from "ai";
import { newTraceId } from "../adapters/tracer";
import type { Config } from "../config";
import { conflict, notFound } from "../domain/errors";
import type { Proposal } from "../domain/types";
import { detectInjection } from "../guardrails/injection";
import { resolve } from "../guardrails/resolve";
import { evaluatePolicy } from "../policy/engine";
import { DEFAULT_POLICY, type PolicyConfig } from "../policy/rules";
import type { AuditLog, ChainClient, Clock, Repository, Tracer } from "../ports";
import { newId, truncate } from "../util";
import { PROMPT_VERSION, SYSTEM_PROMPT, userPrompt } from "./prompt";
import { buildTools, type RunContext } from "./tools";

export interface TriageDeps {
  repo: Repository;
  audit: AuditLog;
  chain: ChainClient;
  clock: Clock;
  tracer: Tracer;
  model: LanguageModel;
  modelName: string;
  config: Pick<Config, "agentMaxSteps" | "agentTimeoutMs" | "proposalTtlMs" | "fourEyesThresholdUsd" | "temperature">;
  policy?: PolicyConfig;
}

export interface TriageResult {
  proposal: Proposal;
  /** True when an open proposal already existed and was returned unchanged. */
  reused: boolean;
}

export class TriageService {
  constructor(private readonly d: TriageDeps) {}

  async triage(withdrawalId: string, actor: string): Promise<TriageResult> {
    const { repo, audit, clock } = this.d;
    const withdrawal = repo.getWithdrawal(withdrawalId);
    if (!withdrawal) throw notFound(`withdrawal ${withdrawalId}`);

    const existing = repo.latestProposalFor(withdrawalId);
    if (existing?.status === "pending" && new Date(existing.expiresAt) > clock.now()) return { proposal: existing, reused: true };
    if (existing?.status === "approved") throw conflict(`withdrawal ${withdrawalId} already has an approved proposal`);
    if (withdrawal.status !== "pending_review") throw conflict(`withdrawal ${withdrawalId} is ${withdrawal.status}, not pending_review`);

    const traceId = newTraceId();
    return this.d.tracer.span("triage", { withdrawalId, traceId, model: this.d.modelName }, async (span) => {
      audit.append({
        kind: "triage_started",
        actor,
        withdrawalId,
        traceId,
        data: { model: this.d.modelName, promptVersion: PROMPT_VERSION },
      });

      const proposal = await this.run(withdrawalId, traceId, span);
      span.setAttributes({ finalAction: proposal.finalAction, degraded: proposal.degraded, overridden: proposal.overridden });
      return { proposal, reused: false };
    });
  }

  private async run(withdrawalId: string, traceId: string, span: { setAttributes(a: Record<string, unknown>): void }): Promise<Proposal> {
    const { repo, audit, chain, clock, tracer, config } = this.d;
    const withdrawal = repo.getWithdrawal(withdrawalId)!;
    const account = repo.getAccount(withdrawal.accountId);
    if (!account) throw notFound(`account ${withdrawal.accountId}`);
    const now = clock.now();

    // 1. Deterministic policy, computed independently of the model.
    const recent24h = repo.recentWithdrawals(account.id, new Date(now.getTime() - 86_400_000).toISOString(), withdrawal.id);
    const verdict = await tracer.span("policy", { traceId }, async () =>
      evaluatePolicy({
        withdrawal,
        account,
        recent24h,
        addressRisk: await chain.addressRisk(withdrawal.address),
        addressUsedBefore: repo.hasCompletedTo(account.id, withdrawal.address, withdrawal.id),
        injection: detectInjection(withdrawal.note),
        now,
        config: this.d.policy ?? DEFAULT_POLICY,
      }),
    );
    audit.append({
      kind: "policy_evaluated",
      actor: "policy",
      withdrawalId,
      traceId,
      data: { floor: verdict.floor, findings: verdict.findings },
    });

    // 2. The agent loop, bounded by step count and wall clock. Failure is a normal outcome, not an exception.
    const ctx: RunContext = { withdrawalId, traceId, repo, chain, audit, clock, tracer, slot: {} };
    let steps = 0;
    let tokens: number | null = null;
    try {
      const result = await tracer.span(
        "agent",
        {
          traceId,
          "gen_ai.request.model": this.d.modelName,
          "gen_ai.request.temperature": config.temperature,
          maxSteps: config.agentMaxSteps,
          promptVersion: PROMPT_VERSION,
        },
        async (agentSpan) => {
          const r = await generateText({
            model: this.d.model,
            system: SYSTEM_PROMPT,
            prompt: userPrompt(withdrawalId),
            tools: buildTools(ctx),
            stopWhen: stepCountIs(config.agentMaxSteps),
            abortSignal: AbortSignal.timeout(config.agentTimeoutMs),
            temperature: config.temperature,
            maxRetries: 1,
          });
          agentSpan.setAttributes({
            "gen_ai.usage.input_tokens": r.usage.inputTokens ?? 0,
            "gen_ai.usage.output_tokens": r.usage.outputTokens ?? 0,
            steps: r.steps.length,
          });
          return r;
        },
      );
      steps = result.steps.length;
      tokens = (result.usage.inputTokens ?? 0) + (result.usage.outputTokens ?? 0);
      if (!ctx.slot.proposed) throw new Error("agent finished without calling proposeAction");
      audit.append({ kind: "agent_proposal", actor: "agent", withdrawalId, traceId, data: { ...ctx.slot.proposed, steps, tokens } });
    } catch (err) {
      ctx.slot.proposed = undefined;
      const message = truncate(err instanceof Error ? err.message : String(err), 300);
      audit.append({ kind: "agent_failed", actor: "agent", withdrawalId, traceId, data: { error: message, steps } });
      span.setAttributes({ agentError: message });
    }

    // 3. Combine. The agent can tighten policy but never loosen it.
    const agent = ctx.slot.proposed ?? null;
    const res = resolve(agent, verdict);
    const requiredApprovals = withdrawal.amountUsd >= config.fourEyesThresholdUsd || res.finalAction === "escalate" ? 2 : 1;

    const proposal: Proposal = {
      id: newId("prop"),
      version: 1,
      withdrawalId,
      status: "pending",
      agentAction: agent?.action ?? null,
      agentReason: agent?.reason ?? null,
      policyFloor: verdict.floor,
      finalAction: res.finalAction,
      overridden: res.overridden,
      degraded: res.degraded,
      reason: res.reason,
      findings: verdict.findings,
      requiredApprovals,
      approvals: [],
      model: this.d.modelName,
      promptVersion: PROMPT_VERSION,
      steps,
      tokens,
      traceId,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + config.proposalTtlMs).toISOString(),
      resolvedAt: null,
    };
    repo.transaction(() => {
      repo.insertProposal(proposal);
      audit.append({
        kind: "proposal_created",
        actor: "system",
        withdrawalId,
        proposalId: proposal.id,
        traceId,
        data: { finalAction: proposal.finalAction, overridden: proposal.overridden, degraded: proposal.degraded, requiredApprovals },
      });
    });
    return proposal;
  }
}
