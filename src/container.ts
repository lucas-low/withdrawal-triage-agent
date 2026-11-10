import { SqliteAuditLog } from "./adapters/audit";
import { MockChainClient } from "./adapters/chain.mock";
import { openDatabase, SqliteStore } from "./adapters/sqlite";
import { consoleTracer, noopTracer } from "./adapters/tracer";
import { createModel } from "./agent/models";
import { TriageService } from "./agent/triage";
import { fixedClock } from "./clock";
import type { Config } from "./config";
import { type Clock, systemClock, type Tracer } from "./ports";
import { ReviewService } from "./workflow/review";

export interface Overrides {
  clock?: Clock;
  tracer?: Tracer;
  dbPath?: string;
}

/** Composition root: the only place concrete adapters are chosen. */
export function createApp(config: Config, o: Overrides = {}) {
  const clock = o.clock ?? (config.clockPin ? fixedClock(config.clockPin) : systemClock);
  const nowIso = () => clock.now().toISOString();
  const db = openDatabase(o.dbPath ?? config.dbPath);
  const store = new SqliteStore(db, nowIso);
  const audit = new SqliteAuditLog(db, nowIso);
  const chain = new MockChainClient();
  const tracer = o.tracer ?? (config.logLevel === "debug" ? consoleTracer() : noopTracer);
  const { model, name } = createModel(config);

  const triage = new TriageService({ repo: store, audit, chain, clock, tracer, model, modelName: name, config });
  const review = new ReviewService({ repo: store, executor: store, audit, clock });
  return { config, db, store, audit, triage, review, clock };
}

export type App = ReturnType<typeof createApp>;
