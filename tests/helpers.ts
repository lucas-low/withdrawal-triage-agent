import type { MockBehavior } from "../src/agent/mock-model";
import { loadConfig } from "../src/config";
import { createApp } from "../src/container";
import type { Principal } from "../src/domain/types";
import type { Clock } from "../src/ports";
import { SEED_NOW, seed } from "../src/seed";

export class FakeClock implements Clock {
  constructor(private t = Date.parse(SEED_NOW)) {}
  now() {
    return new Date(this.t);
  }
  advance(ms: number) {
    this.t += ms;
  }
}

export const alice: Principal = { name: "alice", role: "reviewer" };
export const bob: Principal = { name: "bob", role: "reviewer" };
export const ops: Principal = { name: "ops", role: "operator" };

export function makeApp(opts: { behavior?: MockBehavior; env?: Record<string, string> } = {}) {
  const clock = new FakeClock();
  const config = loadConfig({
    MODEL_PROVIDER: "mock",
    MOCK_MODEL_BEHAVIOR: opts.behavior ?? "competent",
    DB_PATH: ":memory:",
    ...opts.env,
  });
  const app = createApp(config, { clock, dbPath: ":memory:" });
  seed(app.store);
  return { ...app, clock };
}
