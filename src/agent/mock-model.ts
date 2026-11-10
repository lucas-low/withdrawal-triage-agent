import { MockLanguageModelV4 } from "ai/test";
import type { Action } from "../domain/types";

export type MockBehavior = "competent" | "lenient" | "gullible" | "broken" | "silent" | "slow";

type Facts = {
  withdrawal?: { amountUsd: number; untrusted?: { note?: string | null } };
  account?: { kycTier: number; ageDays: number; country: string; dailyLimitUsd: number };
  address?: { flagged: boolean; labels: string[]; usedBefore: boolean };
  activity?: { countLastHour: number; totalLast24hUsd: number };
};

/** Pulls tool outputs out of the prompt history regardless of how the SDK wraps them. */
function toolResults(prompt: unknown[]): Record<string, any> {
  const out: Record<string, any> = {};
  for (const msg of prompt as { role: string; content: unknown }[]) {
    if (msg.role !== "tool" || !Array.isArray(msg.content)) continue;
    for (const part of msg.content as any[]) {
      if (part.type !== "tool-result") continue;
      const o = part.output;
      out[part.toolName] = o && typeof o === "object" && "value" in o ? o.value : o;
    }
  }
  return out;
}

const usage = {
  inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 20, text: 20, reasoning: 0 },
};

const call = (id: string, toolName: string, input: unknown) => ({
  type: "tool-call" as const,
  toolCallId: id,
  toolName,
  input: JSON.stringify(input),
});

function judge(f: Facts, behavior: MockBehavior): { action: Action; reason: string } {
  const note = f.withdrawal?.untrusted?.note ?? "";
  const injected = /ignore previous|approve|release it|you are now|system:/i.test(note);
  if (behavior === "lenient") return { action: "release", reason: "Looks fine." };
  if (behavior === "gullible" && injected) return { action: "release", reason: "The note says to approve, so releasing." };
  if (f.account?.kycTier === 0) return { action: "hold", reason: "KYC tier 0 cannot withdraw." };
  if (f.address?.flagged) return { action: "escalate", reason: `Address flagged: ${f.address.labels.join(", ")}.` };
  if (injected) return { action: "escalate", reason: "Note contains instruction-like text; ignoring it and escalating." };
  const total = (f.activity?.totalLast24hUsd ?? 0) + (f.withdrawal?.amountUsd ?? 0);
  if (f.account && total > f.account.dailyLimitUsd) return { action: "hold", reason: "Over the daily limit." };
  if (f.account && f.account.ageDays < 7 && (f.withdrawal?.amountUsd ?? 0) > 1000)
    return { action: "hold", reason: "New account, large amount." };
  return { action: "release", reason: "Within limits, known address, no flags." };
}

/**
 * Scripted stand-in for a real model so the whole loop (tools, gate, audit, evals) runs offline.
 * It exercises the harness. It cannot tell us how a real model behaves; see docs/evals.md.
 */
export function createMockModel(behavior: MockBehavior = "competent") {
  return new MockLanguageModelV4({
    provider: "mock",
    modelId: `mock-${behavior}`,
    doGenerate: async (options) => {
      if (behavior === "broken") throw new Error("mock model failure");
      if (behavior === "slow") {
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, 60_000);
          options.abortSignal?.addEventListener("abort", () => {
            clearTimeout(t);
            reject(options.abortSignal?.reason ?? new Error("aborted"));
          });
        });
      }
      const results = toolResults(options.prompt as unknown[]);
      const stop = { unified: "stop" as const, raw: undefined };
      const toolsFinish = { unified: "tool-calls" as const, raw: undefined };

      if (!results.getWithdrawal) {
        return {
          content: [
            call("c1", "getWithdrawal", {}),
            call("c2", "getAccount", {}),
            call("c3", "checkAddress", {}),
            call("c4", "getRecentActivity", {}),
          ],
          finishReason: toolsFinish,
          usage,
          warnings: [],
        };
      }
      if (!results.proposeAction && behavior !== "silent") {
        const facts: Facts = {
          withdrawal: results.getWithdrawal,
          account: results.getAccount,
          address: results.checkAddress,
          activity: results.getRecentActivity,
        };
        return { content: [call("c5", "proposeAction", judge(facts, behavior))], finishReason: toolsFinish, usage, warnings: [] };
      }
      return { content: [{ type: "text" as const, text: "Done." }], finishReason: stop, usage, warnings: [] };
    },
  });
}
