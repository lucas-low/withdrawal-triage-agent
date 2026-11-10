import { type Action, maxAction } from "../domain/types";
import type { PolicyVerdict } from "../policy/engine";
import { truncate } from "../util";

export interface Resolution {
  finalAction: Action;
  overridden: boolean;
  degraded: boolean;
  reason: string;
}

/** Action applied when the agent fails. A human still reviews it. */
export const DEGRADED_MINIMUM: Action = "hold";

/**
 * The agent can make the outcome stricter than policy but never looser.
 * If the agent failed, fall back to the stricter of policy and a fail-closed minimum.
 */
export function resolve(agent: { action: Action; reason: string } | null, verdict: PolicyVerdict): Resolution {
  const policyText = verdict.findings.length ? verdict.findings.map((f) => f.message).join(" ") : "No policy rule fired.";
  if (!agent) {
    return {
      finalAction: maxAction(verdict.floor, DEGRADED_MINIMUM),
      overridden: false,
      degraded: true,
      reason: truncate(`Agent unavailable, failing closed. ${policyText}`, 600),
    };
  }
  const finalAction = maxAction(agent.action, verdict.floor);
  const overridden = finalAction !== agent.action;
  const reason = overridden
    ? `Policy raised agent's ${agent.action} to ${finalAction}: ${policyText} Agent said: ${agent.reason}`
    : agent.reason;
  return { finalAction, overridden, degraded: false, reason: truncate(reason, 600) };
}
