import { SqliteAuditLog } from "./adapters/audit";
import { MockChainClient } from "./adapters/chain.mock";
import { loadSanctionList, OnchainChainClient } from "./adapters/chain.onchain";
import { openDatabase, SqliteStore } from "./adapters/sqlite";
import { consoleSink, createTracer, OtlpSink, SqliteSpanSink } from "./adapters/tracer";
import { createModel, createScreenModel } from "./agent/models";
import { TriageService } from "./agent/triage";
import { fixedClock } from "./clock";
import type { Config } from "./config";
import { combineScreens, heuristicScreen, llmScreen } from "./guardrails/note-screen";
import type { PolicyConfig } from "./policy/rules";
import type { ChainClient } from "./ports";
import { type Clock, systemClock, type Tracer } from "./ports";
import { SqlitePrecedentStore } from "./retrieval/precedents";
import { ReviewService } from "./workflow/review";

export interface Overrides {
  clock?: Clock;
  tracer?: Tracer;
  policy?: PolicyConfig;
  chain?: ChainClient;
  dbPath?: string;
}

/** Composition root: the only place concrete adapters are chosen. */
export function createApp(config: Config, o: Overrides = {}) {
  const clock = o.clock ?? (config.clockPin ? fixedClock(config.clockPin) : systemClock);
  const nowIso = () => clock.now().toISOString();
  const db = openDatabase(o.dbPath ?? config.dbPath);
  const store = new SqliteStore(db, nowIso);
  const audit = new SqliteAuditLog(db, nowIso);
  const chain =
    o.chain ??
    (config.chainProvider === "onchain"
      ? new OnchainChainClient(loadSanctionList(config.ofacListPath), { url: config.ethRpcUrl })
      : new MockChainClient());
  const sinks = [new SqliteSpanSink(db)];
  if (config.logLevel === "debug") sinks.push(consoleSink() as never);
  if (config.otlpEndpoint) sinks.push(new OtlpSink(config.otlpEndpoint, config.otlpHeaders) as never);
  const tracerImpl = createTracer(sinks);
  const tracer = o.tracer ?? tracerImpl;
  const { model, name } = createModel(config);

  const screen =
    config.noteHandling === "quarantine"
      ? combineScreens(
          heuristicScreen,
          llmScreen(createScreenModel(config), { temperature: config.temperature, timeoutMs: config.agentTimeoutMs }),
        )
      : heuristicScreen;
  const precedents = new SqlitePrecedentStore(db);
  const triage = new TriageService({
    precedents,
    retrievalEnabled: config.retrievalEnabled,
    policy: o.policy,
    screen,
    noteHandling: config.noteHandling,
    repo: store,
    audit,
    chain,
    clock,
    tracer,
    model,
    modelName: name,
    config,
  });
  const review = new ReviewService({ repo: store, executor: store, audit, clock, precedents });
  return { config, db, store, precedents, audit, triage, review, clock, tracer: tracerImpl };
}

export type App = ReturnType<typeof createApp>;
