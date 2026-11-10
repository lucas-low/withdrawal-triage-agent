import { expect, test } from "bun:test";
import { loadConfig, parseApiKeys } from "../src/config";

test("defaults to the mock provider so nothing needs a key", () => {
  const c = loadConfig({});
  expect(c.modelProvider).toBe("mock");
  expect(c.apiKeys.size).toBeGreaterThan(0);
});

test("anthropic provider requires a key", () => {
  expect(() => loadConfig({ MODEL_PROVIDER: "anthropic" })).toThrow(/ANTHROPIC_API_KEY/);
  expect(loadConfig({ MODEL_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "k" }).modelProvider).toBe("anthropic");
});

test("rejects bad values with a readable message", () => {
  expect(() => loadConfig({ PORT: "abc" })).toThrow(/PORT/);
  expect(() => loadConfig({ MODEL_PROVIDER: "openai" })).toThrow(/MODEL_PROVIDER/);
});

test("parses API keys with roles and rejects malformed entries", () => {
  const m = parseApiKeys("k1:reviewer:alice,k2:auditor:aud");
  expect(m.get("k1")).toEqual({ name: "alice", role: "reviewer" });
  expect(() => parseApiKeys("k1:boss:alice")).toThrow(/role/);
  expect(() => parseApiKeys("k1")).toThrow();
});
