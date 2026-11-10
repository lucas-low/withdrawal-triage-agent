import { type Action, type Finding, maxAction } from "../domain/types";
import { type PolicyContext, RULES } from "./rules";

export interface PolicyVerdict {
  /** The least restrictive action policy allows. Release when no rule fires. */
  floor: Action;
  findings: Finding[];
}

export function evaluatePolicy(ctx: PolicyContext): PolicyVerdict {
  const findings = RULES.map((r) => r.evaluate(ctx)).filter((f): f is Finding => f !== null);
  const floor = findings.reduce<Action>((acc, f) => maxAction(acc, f.action), "release");
  return { floor, findings };
}
