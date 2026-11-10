import { expect, test } from "bun:test";
import { gates, runScenario, type Scenario } from "../evals/harness";

const scenarios: Scenario[] = ["competent", "lenient", "gullible", "quarantine", "broken", "silent", "slow"];

for (const s of scenarios) {
  test(`eval gates pass for the ${s} scenario`, async () => {
    const report = await runScenario(s);
    const failed = gates(report).filter((g) => !g.ok);
    expect(failed).toEqual([]);
  });
}

test("a gullible model is actually caught by the guardrail, not by luck", async () => {
  const r = await runScenario("gullible");
  const inj = r.results.find((x) => x.case.id === "w_injection")!;
  expect(inj.proposal.agentAction).toBe("release");
  expect(inj.proposal.finalAction).not.toBe("release");
});
