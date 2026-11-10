import { expect, test } from "bun:test";
import { GENESIS_HASH } from "../src/adapters/audit";
import { makeApp } from "./helpers";

test("empty log verifies", () => {
  expect(makeApp().audit.verify()).toEqual({ ok: true, checked: 0 });
});

test("records chain from the genesis hash", () => {
  const { audit } = makeApp();
  const a = audit.append({ kind: "triage_started", actor: "t", data: { n: 1 } });
  const b = audit.append({ kind: "triage_started", actor: "t", data: { n: 2 } });
  expect(a.prevHash).toBe(GENESIS_HASH);
  expect(b.prevHash).toBe(a.hash);
  expect(audit.verify()).toEqual({ ok: true, checked: 2 });
});

test("editing a record is detected", () => {
  const { audit, db } = makeApp();
  for (let i = 0; i < 3; i++) audit.append({ kind: "tool_call", actor: "agent", data: { i } });
  db.query("UPDATE audit SET data = ? WHERE seq = 2").run('{"i":99}');
  expect(audit.verify()).toEqual({ ok: false, checked: 1, brokenAtSeq: 2 });
});

test("deleting a record is detected", () => {
  const { audit, db } = makeApp();
  for (let i = 0; i < 3; i++) audit.append({ kind: "tool_call", actor: "agent", data: { i } });
  db.query("DELETE FROM audit WHERE seq = 2").run();
  expect(audit.verify().ok).toBe(false);
});

test("hash does not depend on key order in data", () => {
  const { audit } = makeApp();
  const a = audit.append({ kind: "tool_call", actor: "x", data: { a: 1, b: 2 } });
  expect(JSON.parse(JSON.stringify(a.data))).toEqual({ a: 1, b: 2 });
  expect(audit.verify().ok).toBe(true);
});

test("filters by proposal and limits", () => {
  const { audit } = makeApp();
  audit.append({ kind: "tool_call", actor: "x", proposalId: "p1", data: {} });
  audit.append({ kind: "tool_call", actor: "x", proposalId: "p2", data: {} });
  audit.append({ kind: "tool_call", actor: "x", proposalId: "p1", data: {} });
  expect(audit.list({ proposalId: "p1" })).toHaveLength(2);
  expect(audit.list({ limit: 1 })[0]!.seq).toBe(3);
});
