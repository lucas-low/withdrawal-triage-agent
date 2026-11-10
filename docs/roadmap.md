# Roadmap

Built and tested offline: policy engine, agent loop, guardrails, review workflow, audit chain, HTTP API, review console, CLI, evals, CI.

Not built yet, in rough order:

1. **Run against a real model.** Run `bun run eval -- --live`, read the `agent acc` and override numbers, and tune the prompt. Record the results in `docs/evals.md`.
2. **Tracing adapter.** Implement the `Tracer` port for Langfuse or OpenTelemetry so spans and token usage show up in a trace UI.
3. **Real chain data.** Replace `MockChainClient` with a provider adapter and add retry and caching. Decide what the policy does when the provider is down (currently the call would throw and fail the triage).
4. **Anchor the audit chain.** Periodically publish the head hash somewhere the database admin cannot rewrite.
5. **Networked store.** The ports are synchronous because SQLite is in-process. A Postgres adapter means making them async (ADR 0003).
6. **Real identity.** Replace static bearer keys with SSO and per-user sessions.
7. **Shared rate limiting and spend caps.**
8. **Better agent evals.** Larger dataset, adversarial notes generated at scale, tool-selection accuracy on ambiguous cases.
