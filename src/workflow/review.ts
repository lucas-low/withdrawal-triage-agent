import { AppError, conflict, forbidden, notFound } from "../domain/errors";
import type { DecisionInput, Principal, Proposal } from "../domain/types";
import type { ActionExecutor, AuditLog, Clock, Repository } from "../ports";

export interface ReviewDeps {
  repo: Repository;
  executor: ActionExecutor;
  audit: AuditLog;
  clock: Clock;
}

export interface ReviewResult {
  proposal: Proposal;
  /** Set when this decision completed the approvals and the action was executed. */
  executed: { executionId: string; firstTime: boolean } | null;
}

/**
 * The only code path that can change custody state. Callers are authenticated humans
 * with the reviewer role. The agent has no route here.
 */
export class ReviewService {
  constructor(private readonly d: ReviewDeps) {}

  decide(proposalId: string, reviewer: Principal, input: DecisionInput): ReviewResult {
    if (reviewer.role !== "reviewer") throw forbidden("only reviewers can decide proposals");
    const { repo, audit, clock, executor } = this.d;

    return repo.transaction(() => {
      const current = repo.getProposal(proposalId);
      if (!current) throw notFound(`proposal ${proposalId}`);
      const now = clock.now();

      if (current.status === "pending" && new Date(current.expiresAt) <= now) {
        this.expire(current);
        throw new AppError("expired", `proposal ${proposalId} expired at ${current.expiresAt}`);
      }
      if (current.status !== "pending") throw conflict(`proposal ${proposalId} is already ${current.status}`);
      if (current.approvals.some((a) => a.reviewer === reviewer.name)) {
        throw conflict(`${reviewer.name} has already reviewed this proposal`);
      }

      const approval = { reviewer: reviewer.name, decision: input.decision, comment: input.comment ?? null, at: now.toISOString() };
      const approvals = [...current.approvals, approval];
      const approvedCount = approvals.filter((a) => a.decision === "approve").length;
      const rejected = input.decision === "reject";
      const complete = !rejected && approvedCount >= current.requiredApprovals;

      const next: Proposal = {
        ...current,
        version: current.version + 1,
        approvals,
        status: rejected ? "rejected" : complete ? "approved" : "pending",
        resolvedAt: rejected || complete ? now.toISOString() : null,
      };
      repo.updateProposal(next);
      audit.append({
        kind: "review_decision",
        actor: reviewer.name,
        withdrawalId: next.withdrawalId,
        proposalId: next.id,
        traceId: next.traceId,
        data: {
          decision: input.decision,
          comment: input.comment ?? null,
          approvals: approvedCount,
          required: next.requiredApprovals,
          status: next.status,
        },
      });

      let executed: ReviewResult["executed"] = null;
      if (complete) {
        executed = executor.execute({
          proposalId: next.id,
          withdrawalId: next.withdrawalId,
          action: next.finalAction,
          approvedBy: approvals.filter((a) => a.decision === "approve").map((a) => a.reviewer),
        });
        audit.append({
          kind: "action_executed",
          actor: "system",
          withdrawalId: next.withdrawalId,
          proposalId: next.id,
          traceId: next.traceId,
          data: { action: next.finalAction, ...executed },
        });
      } else if (rejected) {
        // A rejected proposal leaves the withdrawal in pending_review so it can be triaged again or handled manually.
      }
      return { proposal: next, executed };
    });
  }

  /** Marks every overdue pending proposal expired. Safe to call repeatedly (cron or on read). */
  expireOverdue(): number {
    const now = this.d.clock.now();
    let n = 0;
    for (const p of this.d.repo.listProposals({ status: "pending" })) {
      if (new Date(p.expiresAt) <= now) {
        this.d.repo.transaction(() => this.expire(p));
        n++;
      }
    }
    return n;
  }

  private expire(p: Proposal) {
    const { repo, audit, clock } = this.d;
    const next: Proposal = { ...p, version: p.version + 1, status: "expired", resolvedAt: clock.now().toISOString() };
    repo.updateProposal(next);
    audit.append({
      kind: "proposal_expired",
      actor: "system",
      withdrawalId: p.withdrawalId,
      proposalId: p.id,
      traceId: p.traceId,
      data: { expiresAt: p.expiresAt },
    });
  }
}
