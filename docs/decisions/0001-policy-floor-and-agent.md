# 0001. Deterministic policy floor under the agent

**Status:** accepted

**Context.** A model can be wrong, lenient or manipulated by user-written text. Withdrawals move money.

**Decision.** Compute policy findings without the model. The final action is the stricter of the agent's proposal and the policy floor. If the agent fails, fall back to at least `hold`.

**Consequences.** The model's job is to catch what rules cannot (odd context, patterns) and to explain. It cannot make an outcome looser. Cost: rules need maintenance, and the agent adds little on cases rules already cover. Metrics to watch are the override rate and agent-only accuracy.
