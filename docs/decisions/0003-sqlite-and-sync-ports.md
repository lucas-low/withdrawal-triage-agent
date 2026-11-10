# 0003. SQLite and synchronous ports

**Status:** accepted, revisit when going multi-process

**Context.** We need transactions across proposals, audit and execution, with zero setup so the project runs anywhere.

**Decision.** Use `bun:sqlite` (WAL mode, versioned migrations via `user_version`). Keep the repository and audit ports synchronous so a transaction wraps ordinary code.

**Consequences.** One transaction covers a decision, its audit record and the execution. A networked database would require async ports and a different transaction pattern. The unique index on the execution idempotency key and the optimistic version column carry over unchanged.
