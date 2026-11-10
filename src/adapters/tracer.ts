import type { Database } from "bun:sqlite";
import { AsyncLocalStorage } from "node:async_hooks";
import type { Span, SpanRecord, SpanSink, Tracer } from "../ports";

const hex = (bytes: number) => Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
export const newTraceId = () => hex(16);
const isTraceId = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{32}$/.test(v);

export const noopTracer: Tracer = { span: (_n, _a, fn) => fn({ setAttributes() {} }) };

interface Active {
  traceId: string;
  spanId: string;
}
const als = new AsyncLocalStorage<Active>();

/**
 * Nested spans with OpenTelemetry-shaped ids. A root span adopts `attrs.traceId` when it is a
 * 32-character hex string, which is how audit records and traces share one id.
 */
export function createTracer(sinks: SpanSink[]): Tracer & { flush(): Promise<void> } {
  return {
    async span<T>(name: string, attrs: Record<string, unknown>, fn: (span: Span) => Promise<T>): Promise<T> {
      const parent = als.getStore();
      const traceId = parent?.traceId ?? (isTraceId(attrs.traceId) ? attrs.traceId : newTraceId());
      const spanId = hex(8);
      const collected: Record<string, unknown> = { ...attrs };
      const startMs = Date.now();
      const t0 = performance.now();
      const finish = (status: "ok" | "error", error?: unknown) => {
        if (error !== undefined) collected.error = error instanceof Error ? error.message : String(error);
        const rec: SpanRecord = {
          spanId,
          traceId,
          parentId: parent?.spanId ?? null,
          name,
          startMs,
          durationMs: Math.round((performance.now() - t0) * 100) / 100,
          status,
          attrs: collected,
        };
        for (const s of sinks) s.export(rec);
      };
      try {
        const out = await als.run({ traceId, spanId }, () => fn({ setAttributes: (a) => Object.assign(collected, a) }));
        finish("ok");
        return out;
      } catch (err) {
        finish("error", err);
        throw err;
      }
    },
    async flush() {
      await Promise.all(sinks.map((s) => s.flush?.()));
    },
  };
}

export function consoleSink(write: (line: string) => void = (l) => process.stderr.write(`${l}\n`)): SpanSink {
  return { export: (s) => write(JSON.stringify({ span: s.name, ms: s.durationMs, trace: s.traceId, status: s.status, ...s.attrs })) };
}

export function memorySink(): SpanSink & { spans: SpanRecord[] } {
  const spans: SpanRecord[] = [];
  return { spans, export: (s) => void spans.push(s) };
}

/** Persists spans so `cli trace <id>` can show them after the fact. */
export class SqliteSpanSink implements SpanSink {
  constructor(private readonly db: Database) {}
  export(s: SpanRecord) {
    this.db
      .query(
        "INSERT OR REPLACE INTO spans (span_id, trace_id, parent_id, name, start_ms, duration_ms, status, attrs) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(s.spanId, s.traceId, s.parentId, s.name, s.startMs, s.durationMs, s.status, JSON.stringify(s.attrs));
  }
}

export function loadTrace(db: Database, traceId: string): SpanRecord[] {
  const rows = db.query("SELECT * FROM spans WHERE trace_id = ? ORDER BY start_ms, rowid").all(traceId) as {
    span_id: string;
    trace_id: string;
    parent_id: string | null;
    name: string;
    start_ms: number;
    duration_ms: number;
    status: "ok" | "error";
    attrs: string;
  }[];
  return rows.map((r) => ({
    spanId: r.span_id,
    traceId: r.trace_id,
    parentId: r.parent_id,
    name: r.name,
    startMs: r.start_ms,
    durationMs: r.duration_ms,
    status: r.status,
    attrs: JSON.parse(r.attrs),
  }));
}

const otlpValue = (v: unknown) =>
  typeof v === "number"
    ? Number.isInteger(v)
      ? { intValue: String(v) }
      : { doubleValue: v }
    : typeof v === "boolean"
      ? { boolValue: v }
      : { stringValue: typeof v === "string" ? v : JSON.stringify(v) };

/**
 * Exports spans as OTLP/HTTP JSON. Point it at an OpenTelemetry collector or a Langfuse
 * instance (`<host>/api/public/otel`). Delivery is best effort and never blocks or fails a triage.
 */
export class OtlpSink implements SpanSink {
  private pending: Promise<unknown>[] = [];
  constructor(
    private readonly endpoint: string,
    private readonly headers: Record<string, string> = {},
    private readonly serviceName = "withdrawal-triage-agent",
  ) {}

  export(s: SpanRecord) {
    const body = {
      resourceSpans: [
        {
          resource: { attributes: [{ key: "service.name", value: { stringValue: this.serviceName } }] },
          scopeSpans: [
            {
              scope: { name: "withdrawal-triage-agent" },
              spans: [
                {
                  traceId: s.traceId,
                  spanId: s.spanId,
                  ...(s.parentId ? { parentSpanId: s.parentId } : {}),
                  name: s.name,
                  kind: 1,
                  startTimeUnixNano: String(BigInt(Math.round(s.startMs)) * 1_000_000n),
                  endTimeUnixNano: String(BigInt(Math.round(s.startMs + s.durationMs)) * 1_000_000n),
                  attributes: Object.entries(s.attrs).map(([key, v]) => ({ key, value: otlpValue(v) })),
                  status: { code: s.status === "ok" ? 1 : 2 },
                },
              ],
            },
          ],
        },
      ],
    };
    const p = fetch(`${this.endpoint.replace(/\/$/, "")}/v1/traces`, {
      method: "POST",
      headers: { "content-type": "application/json", ...this.headers },
      body: JSON.stringify(body),
    }).catch(() => undefined);
    this.pending.push(p);
    // Drop settled sends so a long-running server does not accumulate them.
    p.finally(() => {
      const i = this.pending.indexOf(p);
      if (i !== -1) this.pending.splice(i, 1);
    });
  }

  async flush() {
    await Promise.allSettled([...this.pending]);
  }
}
