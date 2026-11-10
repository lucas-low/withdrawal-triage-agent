import { audit } from "./audit";

export type Action = "release" | "hold" | "escalate";

export type Proposal = {
  withdrawalId: string;
  action: Action;
  reason: string;
};

const pending = new Map<string, Proposal>();

// The agent can only reach this through the proposeAction tool.
// Nothing here changes withdrawal state; that only happens in decide().
export function propose(p: Proposal) {
  pending.set(p.withdrawalId, p);
  audit({ kind: "proposal", withdrawalId: p.withdrawalId, data: p });
}

export function getPending(withdrawalId: string) {
  return pending.get(withdrawalId);
}

// Called by a human (CLI), never by the model.
export function decide(withdrawalId: string, approved: boolean, reviewer: string) {
  const p = pending.get(withdrawalId);
  if (!p) throw new Error(`no pending proposal for ${withdrawalId}`);
  pending.delete(withdrawalId);
  audit({ kind: "decision", withdrawalId, data: { proposal: p, approved, reviewer } });
  return { applied: approved ? p.action : null };
}
