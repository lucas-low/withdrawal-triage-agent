import { z } from "zod";
import { AppError, type ErrorCode } from "./domain/errors";
import type { Principal, Role } from "./domain/types";

const int = (def: number) => z.coerce.number().int().positive().default(def);

const EnvSchema = z.object({
  MODEL_PROVIDER: z.enum(["mock", "anthropic"]).default("mock"),
  MODEL: z.string().default("claude-sonnet-5-5"),
  MOCK_MODEL_BEHAVIOR: z.enum(["competent", "lenient", "gullible", "broken", "silent", "slow"]).default("competent"),
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
  LOG_LEVEL: z.enum(["silent", "info", "debug"]).default("info"),
});

export interface Config {
  modelProvider: "mock" | "anthropic";
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
  return {
    modelProvider: e.MODEL_PROVIDER,
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
  };
}
