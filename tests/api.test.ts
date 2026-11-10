import { describe, expect, test } from "bun:test";
import { createHandler } from "../src/server/app";
import { makeApp } from "./helpers";

const H = { operator: "Bearer dev-operator", alice: "Bearer dev-alice", bob: "Bearer dev-bob", audit: "Bearer dev-audit" };

function setup(behavior: Parameters<typeof makeApp>[0] = {}) {
  const app = makeApp(behavior);
  const handler = createHandler(app, { triageLimitPerMinute: 3 });
  const call = async (method: string, path: string, auth?: string, body?: unknown) => {
    const res = await handler(
      new Request(`http://t${path}`, {
        method,
        headers: { ...(auth ? { authorization: auth } : {}), "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      }),
    );
    return {
      status: res.status,
      body: (res.headers.get("content-type")?.includes("json") ? await res.json() : await res.text()) as any,
      headers: res.headers,
    };
  };
  return { app, call };
}

describe("auth", () => {
  test("health and UI are public, everything else needs a token", async () => {
    const { call } = setup();
    expect((await call("GET", "/healthz")).status).toBe(200);
    const ui = await call("GET", "/");
    expect(ui.status).toBe(200);
    expect(ui.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect((await call("GET", "/v1/proposals")).status).toBe(401);
    expect((await call("GET", "/v1/proposals", "Bearer wrong")).status).toBe(401);
  });
  test("roles are enforced", async () => {
    const { call } = setup();
    expect((await call("POST", "/v1/withdrawals/w_clean/triage", H.audit)).status).toBe(403);
    const t = await call("POST", "/v1/withdrawals/w_clean/triage", H.operator);
    expect((await call("POST", `/v1/proposals/${t.body.proposal.id}/decision`, H.operator, { decision: "approve" })).status).toBe(403);
    expect((await call("GET", "/v1/audit/verify", H.operator)).status).toBe(403);
  });
});

describe("flow", () => {
  test("triage, four-eyes review, execution, audit verify over HTTP", async () => {
    const { call, app } = setup();
    const t = await call("POST", "/v1/withdrawals/w_flagged/triage", H.operator);
    expect(t.status).toBe(201);
    const id = t.body.proposal.id;
    expect(t.headers.get("x-request-id")).toBeTruthy();

    const again = await call("POST", "/v1/withdrawals/w_flagged/triage", H.operator);
    expect(again.status).toBe(200);
    expect(again.body.reused).toBe(true);

    expect((await call("GET", "/v1/proposals?status=pending", H.alice)).body.proposals).toHaveLength(1);
    const first = await call("POST", `/v1/proposals/${id}/decision`, H.alice, { decision: "approve" });
    expect(first.body.proposal.status).toBe("pending");
    expect((await call("POST", `/v1/proposals/${id}/decision`, H.alice, { decision: "approve" })).status).toBe(409);
    const second = await call("POST", `/v1/proposals/${id}/decision`, H.bob, { decision: "approve", comment: "ok" });
    expect(second.body.executed.firstTime).toBe(true);
    expect(app.store.getWithdrawal("w_flagged")!.status).toBe("escalated");

    expect((await call("GET", `/v1/proposals/${id}/audit`, H.audit)).body.records.length).toBeGreaterThan(2);
    expect((await call("GET", "/v1/audit/verify", H.audit)).body).toMatchObject({ ok: true });
  });
});

describe("validation and errors", () => {
  test("bad decision body is a 400 with a readable message", async () => {
    const { call } = setup();
    const t = await call("POST", "/v1/withdrawals/w_clean/triage", H.operator);
    const bad = await call("POST", `/v1/proposals/${t.body.proposal.id}/decision`, H.alice, { decision: "maybe" });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("invalid_request");
  });
  test("malformed JSON and oversized bodies are 400", async () => {
    const { app } = setup();
    const handler = createHandler(app);
    const mk = (body: string) =>
      handler(new Request("http://t/v1/proposals/x/decision", { method: "POST", headers: { authorization: H.alice }, body }));
    expect((await mk("{nope")).status).toBe(400);
    expect((await mk(JSON.stringify({ decision: "approve", comment: "x".repeat(9000) }))).status).toBe(400);
  });
  test("unknown ids and routes are 404, bad status filter is 400", async () => {
    const { call } = setup();
    expect((await call("POST", "/v1/withdrawals/nope/triage", H.operator)).status).toBe(404);
    expect((await call("GET", "/v1/proposals/nope", H.alice)).status).toBe(404);
    expect((await call("GET", "/v1/nothing", H.alice)).status).toBe(404);
    expect((await call("GET", "/v1/proposals?status=weird", H.alice)).status).toBe(400);
  });
  test("triage is rate limited per caller", async () => {
    const { call } = setup();
    for (const id of ["w_clean", "w_flagged", "w_velocity"])
      expect((await call("POST", `/v1/withdrawals/${id}/triage`, H.operator)).status).toBe(201);
    const limited = await call("POST", "/v1/withdrawals/w_whale/triage", H.operator);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
  });
  test("a degraded agent still yields a reviewable proposal over HTTP", async () => {
    const { call } = setup({ behavior: "broken" });
    const t = await call("POST", "/v1/withdrawals/w_clean/triage", H.operator);
    expect(t.status).toBe(201);
    expect(t.body.proposal).toMatchObject({ degraded: true, finalAction: "hold" });
  });
});
