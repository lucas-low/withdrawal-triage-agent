import { appendFileSync } from "node:fs";

const FILE = process.env.AUDIT_FILE ?? "audit.jsonl";

export type AuditEvent = {
  ts: string;
  kind: "tool_call" | "proposal" | "decision";
  withdrawalId: string;
  data: unknown;
};

export function audit(e: Omit<AuditEvent, "ts">) {
  appendFileSync(FILE, JSON.stringify({ ts: new Date().toISOString(), ...e }) + "\n");
}
