import { describe, expect, test } from "bun:test";
import { loadConfig } from "../src/config";
import { createApp } from "../src/container";
import { ensureDemoData } from "../src/demo";
import { createHandler } from "../src/server/app";

const demoApp = () => createApp(loadConfig({ DEMO_MODE: "true", DB_PATH: ":memory:" }), { dbPath: ":memory:" });
const call = (handler: ReturnType<typeof createHandler>, method: string, path: string, key: string) =>
  handler(new Request(`http://t${path}`, { method, headers: { authorization: `Bearer ${key}` } }));

describe("production guard", () => {
  test("refuses default dev keys in production", () => {
    expect(() => loadConfig({ NODE_ENV: "production" })).toThrow(/dev API keys/);
  });
  test("allows demo mode, explicit override, or real keys", () => {
    expect(loadConfig({ NODE_ENV: "production", DEMO_MODE: "true" }).demoMode).toBe(true);
    expect(() => loadConfig({ NODE_ENV: "production", ALLOW_DEV_KEYS: "true" })).not.toThrow();
    expect(() => loadConfig({ NODE_ENV: "production", API_KEYS: "s3cret:reviewer:alice" })).not.toThrow();
  });
  test("development is unaffected", () => {
    expect(() => loadConfig({})).not.toThrow();
  });
});

describe("demo mode", () => {
  test("seeds an empty database once", () => {
    const app = demoApp();
    ensureDemoData(app);
    const n = app.store.listWithdrawals().length;
    expect(n).toBeGreaterThan(5);
    ensureDemoData(app);
    expect(app.store.listWithdrawals().length).toBe(n);
  });

  test("reset restores the sample data and a clean audit chain", async () => {
    const app = demoApp();
    ensureDemoData(app);
    const handler = createHandler(app);
    const t = await call(handler, "POST", "/v1/withdrawals/w_clean/triage", "dev-operator");
    expect(t.status).toBe(201);
    expect(app.store.listProposals()).toHaveLength(1);
    expect((await call(handler, "POST", "/v1/demo/reset", "dev-operator")).status).toBe(200);
    expect(app.store.listProposals()).toHaveLength(0);
    expect(app.audit.verify()).toEqual({ ok: true, checked: 0 });
    expect(app.store.listWithdrawals({ status: "pending_review" }).length).toBeGreaterThan(5);
  });

  test("reset needs the operator role and only exists in demo mode", async () => {
    const app = demoApp();
    ensureDemoData(app);
    const handler = createHandler(app);
    expect((await call(handler, "POST", "/v1/demo/reset", "dev-alice")).status).toBe(403);
    const normal = createApp(loadConfig({ DB_PATH: ":memory:" }), { dbPath: ":memory:" });
    expect((await call(createHandler(normal), "POST", "/v1/demo/reset", "dev-operator")).status).toBe(404);
  });

  test("healthz reports demo mode and the model", async () => {
    const res = await createHandler(demoApp())(new Request("http://t/healthz"));
    expect(await res.json()).toMatchObject({ ok: true, demo: true, model: "mock/competent" });
  });
});
