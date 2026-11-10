import { mkdirSync, writeFileSync } from "node:fs";
import { gates, runScenario, type Scenario, type ScenarioReport } from "./harness";

const OFFLINE: Scenario[] = ["competent", "no-retrieval", "lenient", "gullible", "quarantine", "broken", "silent", "slow"];
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
};
const live = process.argv.includes("--live");
const runs = Number(arg("runs") ?? 1);
const models = (arg("models") ?? process.env.MODEL ?? "").split(",").filter(Boolean);
const pct = (x: number) => `${Math.round(x * 100)}%`;

const reports: ScenarioReport[] = [];
if (live) {
  const provider = process.env.MODEL_PROVIDER ?? "mock";
  if (provider === "mock") throw new Error("--live needs MODEL_PROVIDER=ollama or anthropic");
  if (!models.length) throw new Error("--live needs --models a,b or MODEL=...");
  console.log(`Live run against ${provider}: ${models.join(", ")} (${runs} run${runs > 1 ? "s" : ""} of ${9} cases each)\n`);
  for (const model of models) {
    process.stdout.write(`  ${model} ... `);
    const t = performance.now();
    const r = await runScenario("live", { ...process.env, MODEL: model, AGENT_TIMEOUT_MS: process.env.AGENT_TIMEOUT_MS ?? "240000" }, runs);
    console.log(`${Math.round((performance.now() - t) / 1000)}s`);
    reports.push(r);
  }
  console.log();
} else {
  console.log("Offline run: scripted mock models. This checks the harness and guardrails, not a real model's judgment.\n");
  for (const s of OFFLINE) reports.push(await runScenario(s));
}

const header = [
  "scenario",
  "model",
  "final acc",
  "agent acc",
  "safety viol",
  "inject ok",
  "overrides",
  "degraded",
  "tools",
  "steps",
  "ms/case",
];
const rows = reports.map((r) => [
  r.scenario,
  r.model,
  pct(r.metrics.finalAccuracy),
  pct(r.metrics.agentAccuracy),
  String(r.metrics.safetyViolations),
  pct(r.metrics.injectionResisted),
  pct(r.metrics.overrideRate),
  pct(r.metrics.degradedRate),
  pct(r.metrics.toolCoverage),
  String(r.metrics.avgSteps),
  String(r.metrics.avgLatencyMs),
]);
const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
const line = (r: string[]) => r.map((c, i) => c.padEnd(widths[i]!)).join("  ");
console.log([line(header), widths.map((w) => "-".repeat(w)).join("  "), ...rows.map(line)].join("\n"));

if (live) {
  for (const r of reports) {
    const misses = r.results.filter((x) => !x.agentCorrect);
    if (!misses.length) continue;
    console.log(`\n${r.model}: agent alone differed from expected on ${misses.length}/${r.results.length}`);
    for (const x of misses)
      console.log(
        `  ${x.case.id}: expected ${x.case.expected}, agent ${x.proposal.agentAction ?? "none"}${x.proposal.degraded ? " (degraded)" : ""}, final ${x.proposal.finalAction}`,
      );
  }
}

const failing = reports.flatMap(gates).filter((g) => !g.ok);
const missed = reports.flatMap((r) =>
  r.scenario === "competent"
    ? r.results.filter((x) => !x.finalCorrect).map((x) => `${x.case.id}: expected ${x.case.expected}, got ${x.proposal.finalAction}`)
    : [],
);
if (missed.length) console.log(`\nMisses:\n${missed.map((m) => `  ${m}`).join("\n")}`);

mkdirSync("evals/out", { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const body = JSON.stringify(
  reports.map((r) => ({
    scenario: r.scenario,
    model: r.model,
    metrics: r.metrics,
    cases: r.results.map((x) => ({
      id: x.case.id,
      expected: x.case.expected,
      agent: x.proposal.agentAction,
      agentReason: x.proposal.agentReason,
      final: x.proposal.finalAction,
      overridden: x.proposal.overridden,
      degraded: x.proposal.degraded,
      steps: x.proposal.steps,
      ms: x.ms,
    })),
  })),
  null,
  2,
);
writeFileSync("evals/out/report.json", body);
if (live) writeFileSync(`evals/out/live-${stamp}.json`, body);

const total = reports.flatMap(gates).length;
console.log(
  failing.length
    ? `\nFAILED gates:\n${failing.map((g) => `  [${g.scenario}/${g.model}] ${g.name}`).join("\n")}`
    : `\nAll ${total} gates passed. Report: evals/out/report.json`,
);
process.exit(failing.length ? 1 : 0);
