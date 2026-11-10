# Architecture

## Layers

```mermaid
flowchart TB
  subgraph Interfaces
    CLI[CLI]
    HTTP[HTTP API + review console]
  end
  subgraph Application
    TS[TriageService]
    RS[ReviewService]
  end
  subgraph Domain
    PE[Policy engine]
    GR[Guardrails: injection, resolve]
    DT[Types and errors]
  end
  subgraph Ports
    RP[Repository]
    EX[ActionExecutor]
    AU[AuditLog]
    CH[ChainClient]
    TR[Tracer]
    CK[Clock]
  end
  subgraph Adapters
    SQ[SQLite store]
    AL[SQLite hash-chained audit]
    MC[Mock chain client]
    TC[Console / memory / noop tracer]
    LM[Mock or Anthropic model]
  end
  CLI --> TS & RS
  HTTP --> TS & RS
  TS --> PE & GR
  TS --> RP & AU & CH & TR & CK
  RS --> RP & EX & AU & CK
  RP & EX --> SQ
  AU --> AL
  CH --> MC
  TR --> TC
  TS --> LM
```

`src/container.ts` is the composition root and the only place concrete adapters are chosen. Everything else depends on the interfaces in `src/ports.ts`.

## Triage sequence

```mermaid
sequenceDiagram
  participant Op as Operator
  participant TS as TriageService
  participant PE as Policy engine
  participant AG as Agent loop
  participant RS as resolve
  participant DB as Store + audit
  Op->>TS: triage(withdrawalId)
  TS->>DB: open proposal exists? (idempotent)
  TS->>PE: evaluate rules (no model involved)
  PE-->>TS: floor + findings
  TS->>AG: generateText with 4 read tools + proposeAction
  AG-->>TS: proposal, or failure / timeout / silence
  TS->>RS: agent result + floor
  RS-->>TS: final action (stricter of both, or fail-closed)
  TS->>DB: insert pending proposal + audit records
```

## Proposal state machine

```mermaid
stateDiagram-v2
  [*] --> pending: triage
  pending --> pending: approve (more approvals needed)
  pending --> approved: approvals reach requiredApprovals
  pending --> rejected: any reject
  pending --> expired: TTL passes
  approved --> [*]: ActionExecutor runs once
  rejected --> [*]
  expired --> [*]
```

A rejected or expired proposal leaves the withdrawal in `pending_review`, so it can be triaged again. An approved one cannot.

## Key rules

| Rule | Where |
|---|---|
| The model cannot apply an action | No tool reaches `ReviewService`; `proposeAction` only fills an in-memory slot |
| Tools are bound to one withdrawal | `buildTools(ctx)` closes over the id; the model passes no ids |
| Final action is at least as strict as policy | `resolve()` takes `maxAction(agent, floor)` |
| Agent failure fails closed | `resolve(null, ...)` returns at least `hold` and marks the proposal `degraded` |
| Four eyes for large or escalated actions | `requiredApprovals` is 2 at 25k USD or when the final action is `escalate` |
| A reviewer cannot approve twice | Checked in `ReviewService.decide` |
| One execution per proposal | Idempotency key `proposal:<id>` with a unique index |
| No lost updates | Optimistic version check in `updateProposal` |

## Observability

Every tool call, policy result, agent proposal, failure, review decision and execution is an audit record carrying a `traceId`. `LOG_LEVEL=debug` also prints JSON spans (`triage`, `policy`, `agent`) with timings. The `Tracer` port is where a Langfuse or OpenTelemetry adapter goes.
