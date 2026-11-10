import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "triage-cli-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const env = {
  ...process.env,
  DB_PATH: join(dir, "t.db"),
  CLOCK_PIN: "2026-11-10T03:00:00.000Z",
  NO_COLOR: "1",
  MODEL_PROVIDER: "mock",
  MOCK_MODEL_BEHAVIOR: "competent",
};

async function cli(...args: string[]) {
  const p = Bun.spawn(["bun", "run", "src/cli/index.ts", ...args], { env, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { out, err, code };
}

test("seed, triage, decide and audit verify through the CLI", async () => {
  expect((await cli("seed")).code).toBe(0);
  expect((await cli("seed")).code).toBe(1);

  const queue = await cli("queue");
  expect(queue.out).toContain("w_flagged");

  const triage = await cli("triage", "w_flagged");
  expect(triage.out).toContain("ESCALATE");
  const id = triage.out.match(/prop_\w+/)![0];

  expect((await cli("decide", id, "approve", "--as", "nobody")).err).toContain('unknown reviewer "nobody"');
  expect((await cli("decide", id, "approve", "--as", "alice")).out).toContain("approvals: 1/2");
  expect((await cli("decide", id, "approve", "--as", "bob")).out).toContain("Executed escalate");

  expect((await cli("show", id)).out).toContain("action_executed");
  const verify = await cli("audit", "verify");
  expect(verify.out).toContain("Audit chain intact");
  expect(verify.code).toBe(0);
});

test("unknown command and bad config exit non-zero with a clear message", async () => {
  expect((await cli("frobnicate")).code).toBe(1);
  const bad = Bun.spawn(["bun", "run", "src/cli/index.ts", "queue"], {
    env: { ...env, MODEL_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "" },
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(await bad.exited).toBe(2);
  expect(await new Response(bad.stderr).text()).toContain("ANTHROPIC_API_KEY");
});
