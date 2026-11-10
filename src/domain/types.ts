import { z } from "zod";

export const ActionSchema = z.enum(["release", "hold", "escalate"]);
export type Action = z.infer<typeof ActionSchema>;

/** Higher rank means more restrictive. The policy floor can only raise the rank of an agent proposal. */
export const ACTION_RANK: Record<Action, number> = { release: 0, hold: 1, escalate: 2 };
export const maxAction = (a: Action, b: Action): Action => (ACTION_RANK[a] >= ACTION_RANK[b] ? a : b);

export type KycTier = 0 | 1 | 2;

export interface Account {
  id: string;
  kycTier: KycTier;
  createdAt: string;
  country: string;
  dailyLimitUsd: number;
}

export type WithdrawalStatus = "completed" | "pending_review" | "released" | "held" | "escalated";

export interface Withdrawal {
  id: string;
  accountId: string;
  asset: string;
  amountUsd: number;
  address: string;
  /** Free text typed by the user. Untrusted. */
  note: string | null;
  status: WithdrawalStatus;
  createdAt: string;
}

export interface Finding {
  ruleId: string;
  action: Action;
  message: string;
  evidence: Record<string, unknown>;
}

export type ProposalStatus = "pending" | "approved" | "rejected" | "expired";

export interface Approval {
  reviewer: string;
  decision: "approve" | "reject";
  comment: string | null;
  at: string;
}

export interface Proposal {
  id: string;
  version: number;
  withdrawalId: string;
  status: ProposalStatus;
  /** What the model proposed. Null when the agent failed (degraded). */
  agentAction: Action | null;
  agentReason: string | null;
  policyFloor: Action;
  finalAction: Action;
  /** True when the policy floor raised the agent's action. */
  overridden: boolean;
  /** True when the agent failed and the system fell back to a fail-closed action. */
  degraded: boolean;
  /** True when the agent skipped proposeAction and needed one forced follow-up turn. */
  nudged: boolean;
  reason: string;
  findings: Finding[];
  requiredApprovals: number;
  approvals: Approval[];
  model: string;
  promptVersion: string;
  steps: number;
  tokens: number | null;
  traceId: string;
  createdAt: string;
  expiresAt: string;
  resolvedAt: string | null;
}

export type Role = "operator" | "reviewer" | "auditor";

export interface Principal {
  name: string;
  role: Role;
}

export const DecisionInputSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  comment: z.string().trim().max(500).optional(),
});
export type DecisionInput = z.infer<typeof DecisionInputSchema>;
