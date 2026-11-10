import { z } from "zod";
import { AppError, type ErrorCode } from "./domain/errors";
import type { Principal, Role } from "./domain/types";

const int = (def: number) => z.coerce.number().int().positive().default(def);

const EnvSchema = z.object({
  MODEL_PROVIDER: z.enum(["mock", "anthropic", "ollama"]).default("mock"),
  OLLAMA_URL: z.string().url().default("http://127.0.0.1:11434/v1"),
  /** 0 keeps local-model evals as repeatable as the model allows. */
  MODEL_TEMPERATURE: z.coerce.number().min(0).max(2).default(0),
  MODEL: z.string().default("claude-sonnet-5-5"),
  MOCK_MODEL_BEHAVIOR: z.enum(["competent", "lenient", "gullible", "forgetful", "broken", "silent", "slow"]).default("competent"),
  ANTHROPIC_API_KEY: z.string().optional(),
  DB_PATH: z.string().default("triage.db"),
  PORT: int(3000),
  /** Comma separated `key:role:name`, for example `k1:reviewer:alice,k2:operator:ops`. */
  API_KEYS: z.string().default("dev-operator:operator:dev-operator,dev-alice:reviewer:alice,dev-bob:reviewer:bob,dev-audit:auditor:audit"),
  AGENT_MAX_STEPS: int(8),
  AGENT_TIMEOUT_MS: int(30_000),
  PROPOSAL_TTL_MS: int(24 * 60 * 60 * 1000),
  FOUR_EYES_THRESHOLD_USD: int(25_000),
  /** ISO timestamp that pins the clock, for deterministic demos against the seed data. */
  CLOCK_PIN: z.string().datetime().optional(),
  /** Base URL of an OTLP/HTTP collector, for example http://localhost:4318. Spans always go to SQLite too. */
  OTLP_ENDPOINT: z.string().url().optional(),
  /** Extra headers as `k=v,k2=v2`, for example `authorization=Basic ...` for Langfuse. */
  OTLP_HEADERS: z.string().optional(),
  /** quarantine: the agent never sees the note, only a classifier verdict. passthrough: the agent reads the note (kept for comparison evals). */
  NOTE_HANDLING: z.enum(["quarantine", "passthrough"]).default("quarantine"),
  /** Model name for the quarantined note classifier. Defaults to MODEL. Mock provider uses a scripted classifier. */
  SCREEN_MODEL: z.string().optional(),
  MOCK_SCREEN_BEHAVIOR: z.enum(["blind", "paranoid", "heuristic"]).default("heuristic"),
  /** mock: offline fixtures. onchain: OFAC list plus a public Ethereum RPC. */
  CHAIN_PROVIDER: z.enum(["mock", "onchain"]).default("mock"),
  ETH_RPC_URL: z.string().url().default("https://ethereum-rpc.publicnode.com"),
  OFAC_LIST_PATH: z.string().default("data/ofac-eth.txt"),
  /** Give the agent a findSimilarCases tool over past reviewer decisions. */
  RETRIEVAL_ENABLED: z.enum(["true", "false"]).default("true"),
  /** Public demo: seeds sample data on first start and allows POST /v1/demo/reset. Sample data and mock model only. */
  DEMO_MODE: z.enum(["true", "false"]).default("false"),
  /** Set to true to start in production with the built-in dev API keys. Refused otherwise. */
  ALLOW_DEV_KEYS: z.enum(["true", "false"]).default("false"),
  NODE_ENV: z.string().optional(),
  LOG_LEVEL: z.enum(["silent", "info", "debug"]).default("info"),
});

export interface Config {
  modelProvider: "mock" | "anthropic" | "ollama";
  ollamaUrl: string;
  temperature: number;
  model: string;
  mockBehavior: z.infer<typeof EnvSchema>["MOCK_MODEL_BEHAVIOR"];
  anthropicApiKey?: string;
  dbPath: string;
  port: number;
  apiKeys: Map<string, Principal>;
  agentMaxSteps: number;
  agentTimeoutMs: number;
  proposalTtlMs: number;
  fourEyesThresholdUsd: number;
  logLevel: "silent" | "info" | "debug";
  clockPin?: string;
  demoMode: boolean;
  retrievalEnabled: boolean;
  chainProvider: "mock" | "onchain";
  ethRpcUrl: string;
  ofacListPath: string;
  noteHandling: "quarantine" | "passthrough";
  screenModel?: string;
  mockScreenBehavior: "blind" | "paranoid" | "heuristic";
  otlpEndpoint?: string;
  otlpHeaders: Record<string, string>;
}

const fail = (code: ErrorCode, msg: string): never => {
  throw new AppError(code, msg);
};

export function parseApiKeys(raw: string): Map<string, Principal> {
  const out = new Map<string, Principal>();
  for (const entry of raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)) {
    const [key, role, name] = entry.split(":");
    if (!key || !name || !["operator", "reviewer", "auditor"].includes(role ?? "")) {
      fail("config", `API_KEYS entry "${entry.split(":")[0]}..." must be key:role:name with role operator|reviewer|auditor`);
    }
    out.set(key!, { name: name!, role: role as Role });
  }
  return out;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    return fail("config", `invalid environment: ${issues}`);
  }
  const e = parsed.data;
  if (e.MODEL_PROVIDER === "anthropic" && !e.ANTHROPIC_API_KEY) {
    fail("config", "MODEL_PROVIDER=anthropic requires ANTHROPIC_API_KEY");
  }
  const usesDevKeys = [...parseApiKeys(e.API_KEYS).keys()].some((k) => k.startsWith("dev-"));
  if (e.NODE_ENV === "production" && usesDevKeys && e.ALLOW_DEV_KEYS !== "true" && e.DEMO_MODE !== "true") {
    fail(
      "config",
      "refusing to start in production with the built-in dev API keys. Set API_KEYS, or DEMO_MODE=true for a sample-data demo.",
    );
  }
  return {
    modelProvider: e.MODEL_PROVIDER,
    ollamaUrl: e.OLLAMA_URL,
    temperature: e.MODEL_TEMPERATURE,
    model: e.MODEL,
    mockBehavior: e.MOCK_MODEL_BEHAVIOR,
    anthropicApiKey: e.ANTHROPIC_API_KEY,
    dbPath: e.DB_PATH,
    port: e.PORT,
    apiKeys: parseApiKeys(e.API_KEYS),
    agentMaxSteps: e.AGENT_MAX_STEPS,
    agentTimeoutMs: e.AGENT_TIMEOUT_MS,
    proposalTtlMs: e.PROPOSAL_TTL_MS,
    fourEyesThresholdUsd: e.FOUR_EYES_THRESHOLD_USD,
    logLevel: e.LOG_LEVEL,
    clockPin: e.CLOCK_PIN,
    demoMode: e.DEMO_MODE === "true",
    retrievalEnabled: e.RETRIEVAL_ENABLED === "true",
    chainProvider: e.CHAIN_PROVIDER,
    ethRpcUrl: e.ETH_RPC_URL,
    ofacListPath: e.OFAC_LIST_PATH,
    noteHandling: e.NOTE_HANDLING,
    screenModel: e.SCREEN_MODEL,
    mockScreenBehavior: e.MOCK_SCREEN_BEHAVIOR,
    otlpEndpoint: e.OTLP_ENDPOINT,
    otlpHeaders: Object.fromEntries(
      (e.OTLP_HEADERS ?? "")
        .split(",")
        .filter(Boolean)
        .map((kv) => {
          const i = kv.indexOf("=");
          return [kv.slice(0, i).trim(), kv.slice(i + 1).trim()];
        }),
    ),
  };
}
