import { expect, test } from "bun:test";
import { createTracer, loadTrace, memorySink, newTraceId, OtlpSink } from "../src/adapters/tracer";
import { makeApp } from "./helpers";

test("nested spans share a trace id and link to their parent", async () => {
  const sink = memorySink();
  const tracer = createTracer([sink]);
  await tracer.span("outer", {}, async () => {
    await tracer.span("inner", {}, async (s) => s.setAttributes({ n: 1 }));
  });
  const [inner, outer] = sink.spans;
  expect(inner!.parentId).toBe(outer!.spanId);
  expect(inner!.traceId).toBe(outer!.traceId);
  expect(inner!.attrs.n).toBe(1);
  expect(outer!.parentId).toBeNull();
});

test("a root span adopts a valid traceId attribute and a failing span records the error", async () => {
  const sink = memorySink();
  const tracer = createTracer([sink]);
  const id = newTraceId();
  await expect(
    tracer.span("boom", { traceId: id }, async () => {
      throw new Error("nope");
    }),
  ).rejects.toThrow("nope");
  expect(sink.spans[0]).toMatchObject({ traceId: id, status: "error" });
  expect(sink.spans[0]!.attrs.error).toBe("nope");
});

test("a triage produces a span tree that matches the proposal's trace id", async () => {
  const app = makeApp();
  const { proposal } = await app.triage.triage("w_clean", "ops");
  const spans = loadTrace(app.db, proposal.traceId);
  const names = spans.map((s) => s.name);
  expect(names).toEqual(
    expect.arrayContaining([
      "triage",
      "policy",
      "agent",
      "tool.getWithdrawal",
      "tool.getAccount",
      "tool.checkAddress",
      "tool.getRecentActivity",
      "tool.proposeAction",
    ]),
  );
  const root = spans.find((s) => s.name === "triage")!;
  expect(root.parentId).toBeNull();
  const agent = spans.find((s) => s.name === "agent")!;
  expect(agent.attrs["gen_ai.usage.input_tokens"]).toBeGreaterThan(0);
  expect(spans.filter((s) => s.name.startsWith("tool.")).every((s) => s.parentId === agent.spanId)).toBe(true);
  expect(app.audit.list({ withdrawalId: "w_clean" }).every((r) => r.traceId === undefined || r.traceId === proposal.traceId)).toBe(true);
});

test("OTLP sink posts well-formed spans and never throws when the collector is down", async () => {
  const received: any[] = [];
  const server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      received.push({ path: new URL(req.url).pathname, auth: req.headers.get("authorization"), body: await req.json() });
      return new Response("{}");
    },
  });
  const sink = new OtlpSink(`http://localhost:${server.port}`, { authorization: "Basic x" });
  const tracer = createTracer([sink]);
  await tracer.span("hello", { n: 2, ok: true, s: "str" }, async () => {});
  await tracer.flush();
  server.stop(true);
  expect(received[0].path).toBe("/v1/traces");
  expect(received[0].auth).toBe("Basic x");
  const span = received[0].body.resourceSpans[0].scopeSpans[0].spans[0];
  expect(span.name).toBe("hello");
  expect(span.traceId).toMatch(/^[0-9a-f]{32}$/);
  expect(span.spanId).toMatch(/^[0-9a-f]{16}$/);
  expect(BigInt(span.endTimeUnixNano) >= BigInt(span.startTimeUnixNano)).toBe(true);
  expect(span.attributes.find((a: any) => a.key === "n").value).toEqual({ intValue: "2" });

  const dead = createTracer([new OtlpSink("http://127.0.0.1:1")]);
  await dead.span("x", {}, async () => {});
  await dead.flush();
});
