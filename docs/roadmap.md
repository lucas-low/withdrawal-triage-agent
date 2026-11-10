# Roadmap

Built and tested offline: policy engine, agent loop, guardrails, review workflow, audit chain, HTTP API, review console, CLI, evals, CI.

Not built yet, in rough order:

1. **Record local-model results.** Run `MODEL_PROVIDER=ollama bun run eval -- --live --models ... --runs 3`, put the table in `docs/evals.md`, and tune the prompt where the agent alone misses.
2. **Point OTLP at a real backend.** The exporter is built and tested against a local receiver. Verify it against Langfuse or a collector.
3. **Real chain data.** Replace `MockChainClient` with a provider adapter and add retry and caching. Decide what the policy does when the provider is down (currently the call would throw and fail the triage).
4. **Anchor the audit chain.** Periodically publish the head hash somewhere the database admin cannot rewrite.
5. **Networked store.** The ports are synchronous because SQLite is in-process. A Postgres adapter means making them async (ADR 0003).
6. **Real identity.** Replace static bearer keys with SSO and per-user sessions.
7. **Shared rate limiting and spend caps.**
8. **Better agent evals.** Larger dataset, adversarial notes generated at scale, tool-selection accuracy on ambiguous cases.
