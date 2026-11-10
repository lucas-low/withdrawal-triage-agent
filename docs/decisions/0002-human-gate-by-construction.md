# 0002. The agent has no path to execution

**Status:** accepted

**Context.** Approval gates that are a prompt instruction ("ask before executing") fail when the model is manipulated.

**Decision.** No tool changes custody state. `proposeAction` writes to an in-memory slot that the orchestrator persists as a pending proposal. Only `ReviewService.decide()` calls the executor, and it requires an authenticated principal with the `reviewer` role.

**Consequences.** The safety property holds regardless of model behaviour. Adding a state-changing tool would break it, so the threat model calls that out. Two-person approval is enforced in the same place.
