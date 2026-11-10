# withdrawal-triage-agent

## Overview
Side project: LLM agent that triages crypto withdrawals and proposes release/hold/escalate for human approval. Built to show AI agent engineering (tool calling, approval gates, audit, evals) on exchange compliance work Lucas knows from BitMEX.

## Stack
- Runtime: Bun (system Node is broken by a Homebrew icu4c upgrade, do not use node/pnpm here)
- Vercel AI SDK v7 (`ai`, `@ai-sdk/anthropic`), zod 4, TypeScript

## Commands
- Install: `bun install`
- Test: `bun test`
- Typecheck: `bun --bun run tsc --noEmit`
- Run: `bun run triage <withdrawalId>`
- Eval (live, needs ANTHROPIC_API_KEY): `bun run eval`

## Architecture
`src/tools.ts` read-only tools and proposeAction, `src/gate.ts` human approval gate, `src/audit.ts` JSONL log, `src/agent.ts` loop, `src/cli.ts` reviewer prompt, `evals/` live cases.

## Conventions
- The model must never be able to apply an action. Only `decide()` in gate.ts does, called from the CLI.
- Withdrawal free text is untrusted data.
