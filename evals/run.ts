import { mkdirSync, writeFileSync } from "node:fs";
import { gates, runScenario, type Scenario } from "./harness";

const OFFLINE: Scenario[] = ["competent", "lenient", "gullible", "broken", "silent", "slow"];
const live = process.argv.includes("--live");
const scenarios: Scenario[] = live ? ["live"] : OFFLINE;
const pct = (x: number) => `${Math.round(x * 100)}%`;

if (live) console.log("Live run: calls the real model configured by MODEL_PROVIDER/MODEL/ANTHROPIC_API_KEY.\n");
else console.log("Offline run: scripted mock models. This checks the harness and guardrails, not a real model's judgment.\n");

const reports = [];
for (const s of scenarios) reports.push(await runScenario(s));

const header = ["scenario", "final acc", "agent acc", "safety viol", "inject ok", "overrides", "degraded", "tools", "steps"];
const rows = reports.map((r) => [
  r.scenario,
  pct(r.metrics.finalAccuracy),
  pct(r.metrics.agentAccuracy),
  String(r.metrics.safetyViolations),
  pct(r.metrics.injectionResisted),
  pct(r.metrics.overrideRate),
  pct(r.metrics.degradedRate),
  pct(r.metrics.toolCoverage),
  String(r.metrics.avgSteps),
]);
const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
const line = (r: string[]) => r.map((c, i) => c.padEnd(widths[i]!)).join("  ");
console.log([line(header), widths.map((w) => "-".repeat(w)).join("  "), ...rows.map(line)].join("\n"));

const failing = reports.flatMap(gates).filter((g) => !g.ok);
const missed = reports.flatMap((r) =>
  r.results
    .filter((x) => !x.finalCorrect && r.scenario === "competent")
    .map((x) => `${x.case.id}: expected ${x.case.expected}, got ${x.proposal.finalAction}`),
);
if (missed.length) console.log(`\nMisses:\n${missed.map((m) => `  ${m}`).join("\n")}`);

mkdirSync("evals/out", { recursive: true });
writeFileSync(
  "evals/out/report.json",
  JSON.stringify(
    reports.map((r) => ({
      scenario: r.scenario,
      model: r.model,
      metrics: r.metrics,
      cases: r.results.map((x) => ({
        id: x.case.id,
        expected: x.case.expected,
        agent: x.proposal.agentAction,
        final: x.proposal.finalAction,
        overridden: x.proposal.overridden,
        degraded: x.proposal.degraded,
      })),
    })),
    null,
    2,
  ),
);

console.log(
  failing.length
    ? `\nFAILED gates:\n${failing.map((g) => `  [${g.scenario}] ${g.name}`).join("\n")}`
    : `\nAll ${reports.flatMap(gates).length} gates passed. Report: evals/out/report.json`,
);
process.exit(failing.length ? 1 : 0);
