import type { Proposal } from "../domain/types";

const useColor = !process.env.NO_COLOR && process.stdout.isTTY;
const c = (code: number) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
export const bold = c(1);
export const dim = c(2);
export const red = c(31);
export const green = c(32);
export const yellow = c(33);

export const actionColor = (a: string) => (a === "release" ? green : a === "hold" ? yellow : red)(a.toUpperCase());

export function formatProposal(p: Proposal): string {
  const lines = [
    `${bold(p.id)}  withdrawal ${p.withdrawalId}  ${actionColor(p.finalAction)}  [${p.status}]`,
    `  ${p.reason}`,
    `  agent: ${p.agentAction ?? "none"}   policy floor: ${p.policyFloor}${p.overridden ? yellow("   (policy overrode agent)") : ""}${p.degraded ? red("   (agent failed, failed closed)") : ""}`,
    `  approvals: ${p.approvals.filter((a) => a.decision === "approve").length}/${p.requiredApprovals}   expires ${p.expiresAt}`,
  ];
  for (const f of p.findings) lines.push(`  ${dim("-")} ${f.ruleId}: ${f.message}`);
  return lines.join("\n");
}

/** Fixed-width table with the header underlined by dashes. */
export function table(rows: string[][]): string {
  const widths = rows[0]!.map((_, i) => Math.max(...rows.map((r) => stripAnsi(r[i] ?? "").length)));
  const fmt = (r: string[]) => r.map((cell, i) => cell + " ".repeat(widths[i]! - stripAnsi(cell).length)).join("  ");
  return [fmt(rows[0]!), widths.map((w) => "-".repeat(w)).join("  "), ...rows.slice(1).map(fmt)].join("\n");
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: matching ANSI escapes
const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
