# withdrawal-triage-agent

An LLM agent that triages crypto withdrawals for a compliance reviewer. It reads account and address data through tools, then proposes release, hold or escalate. A human approves or rejects. The agent never executes anything.

## How it works
- `src/tools.ts`: read-only tools plus `proposeAction`. Tools are bound to one withdrawal id, so the model cannot look at other accounts.
- `src/gate.ts`: approval gate. `proposeAction` only stores a pending proposal. `decide()` is the only thing that applies an action, and only the CLI calls it.
- `src/audit.ts`: append-only JSONL log of every tool call, proposal and human decision.
- `src/agent.ts`: tool-calling loop (Vercel AI SDK, capped at 8 steps). The system prompt treats withdrawal free-text as untrusted.
- `evals/run.ts`: labelled cases against the live model, including a prompt-injection case (`w_3`).

## Run
```sh
bun install
bun test                         # gate, audit and tool-binding tests, no API key needed
export ANTHROPIC_API_KEY=...
bun run triage w_2               # propose + approve/reject prompt
bun run eval                     # live eval cases
```

## Not built yet
- Real chain data (currently mock fixtures in `src/data.ts`)
- Postgres for state and audit (currently in-memory and JSONL)
- Request tracing (Langfuse) and CI for the eval run
- Server-side conversation history
