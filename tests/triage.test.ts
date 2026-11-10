import { describe, expect, test } from "bun:test";
import { createTracer, memorySink } from "../src/adapters/tracer";
import { makeApp } from "./helpers";

describe("triage with the competent mock model", () => {
  test("clean withdrawal: agent and policy agree on release, one approval needed", async () => {
    const app = makeApp();
    const { proposal, reused } = await app.triage.triage("w_clean", "ops");
    expect(reused).toBe(false);
    expect(proposal).toMatchObject({
      finalAction: "release",
      agentAction: "release",
      policyFloor: "release",
      overridden: false,
      degraded: false,
      requiredApprovals: 1,
      status: "pending",
    });
    expect(proposal.steps).toBeGreaterThanOrEqual(2);
    expect(proposal.tokens).toBeGreaterThan(0);
  });

  test("flagged address escalates and needs two approvals", async () => {
    const { proposal } = await makeApp().triage.triage("w_flagged", "ops");
    expect(proposal).toMatchObject({ finalAction: "escalate", requiredApprovals: 2 });
    expect(proposal.findings.map((f) => f.ruleId)).toContain("FLAGGED_ADDRESS");
  });

  test("prompt injection in the note never produces a release", async () => {
    const { proposal } = await makeApp().triage.triage("w_injection", "ops");
    expect(proposal.finalAction).not.toBe("release");
    expect(proposal.findings.map((f) => f.ruleId)).toEqual(expect.arrayContaining(["KYC_TIER_0", "NOTE_INJECTION"]));
  });

  test("a polite note is not treated as an attack", async () => {
    const { proposal } = await makeApp().triage.triage("w_soft_injection", "ops");
    expect(proposal.finalAction).toBe("release");
  });

  test("large withdrawals require four eyes even when released", async () => {
    const { proposal } = await makeApp().triage.triage("w_whale", "ops");
    expect(proposal.requiredApprovals).toBe(2);
  });

  test("velocity is caught", async () => {
    const { proposal } = await makeApp().triage.triage("w_velocity", "ops");
    expect(proposal.finalAction).toBe("hold");
    expect(proposal.findings.map((f) => f.ruleId)).toContain("VELOCITY");
  });
});

describe("guardrails against bad models", () => {
  test("a lenient model that releases everything is overridden by policy", async () => {
    const { proposal } = await makeApp({ behavior: "lenient" }).triage.triage("w_flagged", "ops");
    expect(proposal).toMatchObject({ agentAction: "release", finalAction: "escalate", overridden: true });
  });

  test("a gullible model that follows the injection is overridden", async () => {
    const { proposal } = await makeApp({ behavior: "gullible", env: { NOTE_HANDLING: "passthrough" } }).triage.triage("w_injection", "ops");
    expect(proposal.agentAction).toBe("release");
    expect(proposal.finalAction).not.toBe("release");
    expect(proposal.overridden).toBe(true);
  });

  test("a broken model fails closed", async () => {
    const { proposal } = await makeApp({ behavior: "broken" }).triage.triage("w_clean", "ops");
    expect(proposal).toMatchObject({ degraded: true, agentAction: null, finalAction: "hold" });
  });

  test("a model that forgets to call proposeAction is nudged once and still produces a proposal", async () => {
    const { proposal } = await makeApp({ behavior: "forgetful" }).triage.triage("w_clean", "ops");
    expect(proposal).toMatchObject({ nudged: true, degraded: false, agentAction: "release" });
  });

  test("a competent model is not nudged", async () => {
    const { proposal } = await makeApp().triage.triage("w_clean", "ops");
    expect(proposal.nudged).toBe(false);
  });

  test("a model that never proposes fails closed", async () => {
    const { proposal } = await makeApp({ behavior: "silent" }).triage.triage("w_clean", "ops");
    expect(proposal).toMatchObject({ degraded: true, finalAction: "hold" });
  });

  test("a slow model hits the timeout and fails closed", async () => {
    const { proposal } = await makeApp({ behavior: "slow", env: { AGENT_TIMEOUT_MS: "50" } }).triage.triage("w_clean", "ops");
    expect(proposal.degraded).toBe(true);
  });
});

describe("idempotency and state", () => {
  test("triaging twice returns the same open proposal", async () => {
    const app = makeApp();
    const a = await app.triage.triage("w_clean", "ops");
    const b = await app.triage.triage("w_clean", "ops");
    expect(b.reused).toBe(true);
    expect(b.proposal.id).toBe(a.proposal.id);
    expect(app.store.listProposals()).toHaveLength(1);
  });

  test("unknown withdrawal is not found", async () => {
    await expect(makeApp().triage.triage("nope", "ops")).rejects.toMatchObject({ code: "not_found" });
  });

  test("completed withdrawals cannot be triaged", async () => {
    await expect(makeApp().triage.triage("h_1", "ops")).rejects.toMatchObject({ code: "conflict" });
  });

  test("an expired proposal can be re-triaged", async () => {
    const app = makeApp({ env: { PROPOSAL_TTL_MS: "1000" } });
    const first = await app.triage.triage("w_clean", "ops");
    app.clock.advance(5_000);
    app.review.expireOverdue();
    const second = await app.triage.triage("w_clean", "ops");
    expect(second.proposal.id).not.toBe(first.proposal.id);
  });
});

describe("audit and tracing", () => {
  test("every step of a triage lands in a verifiable audit trail", async () => {
    const app = makeApp();
    const { proposal } = await app.triage.triage("w_clean", "ops");
    const kinds = app.audit.list({ withdrawalId: "w_clean" }).map((r) => r.kind);
    expect(kinds[0]).toBe("triage_started");
    expect(kinds).toEqual(expect.arrayContaining(["policy_evaluated", "tool_call", "agent_proposal", "proposal_created"]));
    expect(app.audit.list({ proposalId: proposal.id }).length).toBeGreaterThan(0);
    expect(app.audit.verify().ok).toBe(true);
  });

  test("tool calls cannot reach another withdrawal", async () => {
    const app = makeApp();
    await app.triage.triage("w_clean", "ops");
    const calls = app.audit.list({ withdrawalId: "w_clean" }).filter((r) => r.kind === "tool_call");
    expect(calls.length).toBeGreaterThanOrEqual(4);
    for (const c of calls) expect(c.withdrawalId).toBe("w_clean");
  });

  test("passthrough mode delivers the note only inside the untrusted field", async () => {
    const app = makeApp({ env: { NOTE_HANDLING: "passthrough" } });
    await app.triage.triage("w_injection", "ops");
    const call = app.audit
      .list({ withdrawalId: "w_injection" })
      .find((r) => r.kind === "tool_call" && (r.data as any).tool === "getWithdrawal")!;
    expect((call.data as any).output.untrusted.note).toContain("ignore previous instructions");
    expect((call.data as any).output).not.toHaveProperty("note");
  });

  test("quarantine mode (the default) never puts the note text in front of the agent", async () => {
    const app = makeApp({ behavior: "gullible", env: { MOCK_SCREEN_BEHAVIOR: "blind" } });
    const { proposal } = await app.triage.triage("w_injection", "ops");
    const outputs = app.audit
      .list({ withdrawalId: "w_injection" })
      .filter((r) => r.kind === "tool_call")
      .map((r) => JSON.stringify(r.data));
    expect(outputs.join("\n")).not.toContain("ignore previous instructions");
    expect(outputs.join("\n")).not.toContain("SYSTEM");
    // even a classifier that says "safe" cannot make the agent release: it never saw the attack
    expect(proposal.agentAction).not.toBe("release");
  });

  test("a note screen that always errors fails closed to escalate", async () => {
    const { llmScreen } = await import("../src/guardrails/note-screen");
    const { MockLanguageModelV4 } = await import("ai/test");
    const broken = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new Error("down");
      },
    });
    expect(await llmScreen(broken).screen("rent")).toMatchObject({ detected: true, matches: ["llm:unavailable"] });
    expect(await llmScreen(broken).screen(null)).toMatchObject({ detected: false });
  });

  test("spans are emitted", async () => {
    const sink = memorySink();
    const tracer = createTracer([sink]);
    const base = makeApp();
    const { createApp } = await import("../src/container");
    const { seed } = await import("../src/seed");
    const app = createApp(base.config, { clock: base.clock, tracer, dbPath: ":memory:" });
    seed(app.store);
    await app.triage.triage("w_clean", "ops");
    expect(sink.spans.map((s) => s.name)).toEqual(expect.arrayContaining(["policy", "agent", "triage"]));
  });
});
