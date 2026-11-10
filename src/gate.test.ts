import { beforeEach, expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";

process.env.AUDIT_FILE = "/tmp/triage-test-audit.jsonl";
const { propose, decide, getPending } = await import("./gate");
const { makeTools } = await import("./tools");

beforeEach(() => rmSync(process.env.AUDIT_FILE!, { force: true }));

test("proposeAction stores a pending proposal and applies nothing", async () => {
  const tools = makeTools("w_2");
  const out = await tools.proposeAction.execute!({ action: "hold", reason: "flagged" }, {} as any);
  expect(out).toEqual({ status: "pending_human_review" });
  expect(getPending("w_2")?.action).toBe("hold");
});

test("only decide() applies, and rejection applies nothing", () => {
  propose({ withdrawalId: "w_1", action: "release", reason: "ok" });
  expect(decide("w_1", false, "lucas").applied).toBeNull();
  expect(getPending("w_1")).toBeUndefined();
});

test("deciding without a proposal throws", () => {
  expect(() => decide("w_none", true, "lucas")).toThrow();
});

test("tools are bound to the given withdrawal", async () => {
  const tools = makeTools("w_1");
  const w: any = await tools.getWithdrawal.execute!({}, {} as any);
  expect(w.id).toBe("w_1");
});

test("every step lands in the audit log", async () => {
  const tools = makeTools("w_2");
  await tools.checkAddress.execute!({}, {} as any);
  propose({ withdrawalId: "w_2", action: "escalate", reason: "x" });
  decide("w_2", true, "lucas");
  const kinds = readFileSync(process.env.AUDIT_FILE!, "utf8").trim().split("\n").map((l) => JSON.parse(l).kind);
  expect(kinds).toEqual(["tool_call", "proposal", "decision"]);
});
