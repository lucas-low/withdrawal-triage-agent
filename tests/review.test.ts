import { describe, expect, test } from "bun:test";
import { alice, bob, makeApp, ops } from "./helpers";

const approve = { decision: "approve" as const };

async function proposalFor(app: ReturnType<typeof makeApp>, id: string) {
  return (await app.triage.triage(id, "ops")).proposal;
}

describe("review workflow", () => {
  test("a single approval executes a one-approval proposal exactly once", async () => {
    const app = makeApp();
    const p = await proposalFor(app, "w_clean");
    const r = app.review.decide(p.id, alice, approve);
    expect(r.proposal.status).toBe("approved");
    expect(r.executed?.firstTime).toBe(true);
    expect(app.store.getWithdrawal("w_clean")!.status).toBe("released");
  });

  test("four-eyes: first approval leaves it pending, second distinct approval executes", async () => {
    const app = makeApp();
    const p = await proposalFor(app, "w_flagged");
    const first = app.review.decide(p.id, alice, approve);
    expect(first.proposal.status).toBe("pending");
    expect(first.executed).toBeNull();
    expect(app.store.getWithdrawal("w_flagged")!.status).toBe("pending_review");
    const second = app.review.decide(p.id, bob, approve);
    expect(second.proposal.status).toBe("approved");
    expect(app.store.getWithdrawal("w_flagged")!.status).toBe("escalated");
  });

  test("the same reviewer cannot approve twice", async () => {
    const app = makeApp();
    const p = await proposalFor(app, "w_flagged");
    app.review.decide(p.id, alice, approve);
    expect(() => app.review.decide(p.id, alice, approve)).toThrow(/already reviewed/);
  });

  test("one rejection ends it and applies nothing", async () => {
    const app = makeApp();
    const p = await proposalFor(app, "w_flagged");
    app.review.decide(p.id, alice, approve);
    const r = app.review.decide(p.id, bob, { decision: "reject", comment: "address looks wrong" });
    expect(r.proposal.status).toBe("rejected");
    expect(r.executed).toBeNull();
    expect(app.store.getWithdrawal("w_flagged")!.status).toBe("pending_review");
  });

  test("operators and auditors cannot decide", async () => {
    const app = makeApp();
    const p = await proposalFor(app, "w_clean");
    expect(() => app.review.decide(p.id, ops, approve)).toThrow(/only reviewers/);
    expect(() => app.review.decide(p.id, { name: "aud", role: "auditor" }, approve)).toThrow(/only reviewers/);
    expect(app.store.getProposal(p.id)!.approvals).toHaveLength(0);
  });

  test("a resolved proposal cannot be decided again", async () => {
    const app = makeApp();
    const p = await proposalFor(app, "w_clean");
    app.review.decide(p.id, alice, approve);
    expect(() => app.review.decide(p.id, bob, approve)).toThrow(/already approved/);
  });

  test("an expired proposal cannot be approved", async () => {
    const app = makeApp({ env: { PROPOSAL_TTL_MS: "1000" } });
    const p = await proposalFor(app, "w_clean");
    app.clock.advance(2_000);
    expect(() => app.review.decide(p.id, alice, approve)).toThrow(/expired/);
    expect(app.store.getWithdrawal("w_clean")!.status).toBe("pending_review");
  });

  test("expireOverdue marks and audits expired proposals, idempotently", async () => {
    const app = makeApp({ env: { PROPOSAL_TTL_MS: "1000" } });
    const p = await proposalFor(app, "w_clean");
    app.clock.advance(2_000);
    expect(app.review.expireOverdue()).toBe(1);
    expect(app.review.expireOverdue()).toBe(0);
    expect(app.store.getProposal(p.id)!.status).toBe("expired");
    expect(app.audit.list({ proposalId: p.id }).map((r) => r.kind)).toContain("proposal_expired");
  });

  test("unknown proposal is not found", () => {
    expect(() => makeApp().review.decide("prop_x", alice, approve)).toThrow(/not found/);
  });

  test("the whole lifecycle leaves an intact audit chain", async () => {
    const app = makeApp();
    const p = await proposalFor(app, "w_flagged");
    app.review.decide(p.id, alice, approve);
    app.review.decide(p.id, bob, approve);
    const kinds = app.audit.list({ proposalId: p.id }).map((r) => r.kind);
    expect(kinds).toEqual(["proposal_created", "review_decision", "review_decision", "action_executed"]);
    expect(app.audit.verify().ok).toBe(true);
  });

  test("optimistic concurrency rejects a stale write", async () => {
    const app = makeApp();
    const p = await proposalFor(app, "w_clean");
    app.store.updateProposal({ ...p, version: p.version + 1 });
    expect(() => app.store.updateProposal({ ...p, version: p.version + 1 })).toThrow(/concurrently/);
  });
});
