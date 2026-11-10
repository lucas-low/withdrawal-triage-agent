import type { Span, Tracer } from "../ports";

class AttrSpan implements Span {
  attrs: Record<string, unknown> = {};
  setAttributes(a: Record<string, unknown>) {
    Object.assign(this.attrs, a);
  }
}

export const noopTracer: Tracer = {
  span: (_n, _a, fn) => fn({ setAttributes() {} }),
};

/** Structured span logs to stderr. The slot a Langfuse or OpenTelemetry tracer plugs into. */
export function consoleTracer(write: (line: string) => void = (l) => process.stderr.write(`${l}\n`)): Tracer {
  return {
    async span(name, attrs, fn) {
      const span = new AttrSpan();
      const start = performance.now();
      try {
        const out = await fn(span);
        write(JSON.stringify({ span: name, ms: Math.round(performance.now() - start), ...attrs, ...span.attrs }));
        return out;
      } catch (err) {
        write(JSON.stringify({ span: name, ms: Math.round(performance.now() - start), ...attrs, ...span.attrs, error: String(err) }));
        throw err;
      }
    },
  };
}

export interface RecordedSpan {
  name: string;
  attrs: Record<string, unknown>;
  error?: string;
}

/** Collects spans in memory for tests. */
export function memoryTracer(): Tracer & { spans: RecordedSpan[] } {
  const spans: RecordedSpan[] = [];
  return {
    spans,
    async span(name, attrs, fn) {
      const span = new AttrSpan();
      try {
        const out = await fn(span);
        spans.push({ name, attrs: { ...attrs, ...span.attrs } });
        return out;
      } catch (err) {
        spans.push({ name, attrs: { ...attrs, ...span.attrs }, error: String(err) });
        throw err;
      }
    },
  };
}
