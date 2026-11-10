# withdrawal-triage-agent

## Overview
Side project: an AI agent proposes release/hold/escalate for crypto withdrawals, a deterministic policy floor bounds it, and a human reviewer decides. Built to show AI agent engineering (tool calling, guardrails, approval gates, audit, evals) on exchange compliance work Lucas knows from BitMEX. Runs fully offline on a scripted mock model; no API key needed until the live eval step.

## Stack
- Runtime: Bun (system Node is broken by a Homebrew icu4c upgrade, do not use node/pnpm/npx here)
- Vercel AI SDK v7 (`ai`, `@ai-sdk/anthropic`), zod 4, TypeScript 7, bun:sqlite, Biome

## Commands
- Install: `bun install`
- Test: `bun test`
- Typecheck: `bun --bun run tsc --noEmit`
- Lint/format: `bun --bun run biome check --write .`
- Offline eval: `bun run eval` (live: `bun run eval -- --live`, needs ANTHROPIC_API_KEY)
- Everything: `bun run check`
- Demo: `CLOCK_PIN=2026-11-10T03:00:00.000Z bun run cli seed && ... cli triage --all`

## Architecture
Ports in `src/ports.ts`, wiring in `src/container.ts`. `policy/` rules and engine, `guardrails/` injection and resolve, `agent/` tools, prompt, triage, mock models, `workflow/review.ts` is the only code that applies an action, `adapters/` SQLite and audit chain, `server/` HTTP and console, `cli/`. Docs in `docs/` (architecture, policy, api, threat-model, evals, roadmap, ADRs).

## Conventions
- The model must never be able to apply an action. Do not add a state-changing tool.
- Final action = stricter of agent and policy floor. Agent failure fails closed.
- Withdrawal free text is untrusted data; it reaches the model only in the `untrusted` field.
- Every new bug becomes an eval case or a test (see `w_soft_injection`).
- Offline evals test the harness, not a real model. Say so whenever quoting results.
