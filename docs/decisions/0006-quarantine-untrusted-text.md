# 0006. Quarantine untrusted text instead of detecting attacks in it

**Status:** accepted

**Context.** Customers type a free-text note into the withdrawal form. A regex detector looked good on the samples it was written against (97%) and caught 1 of 16 attacks written afterwards. Pattern matching cannot be the defence.

**Decision.** In the default `quarantine` mode the agent never sees the note. A separate classifier model with no tools reads it and returns one boolean. The agent receives only `noteFlagged`. Classifier errors and unparseable output count as suspicious. The regex screen still runs alongside it as a cheap extra signal.

**Consequences.** An injection can at worst make the classifier answer wrongly, which leaves the decision where it would have been without the note. It cannot steer the agent. The cost is an extra model call and that the agent cannot use the note's content, which was never needed for the decision. Measured in `bun run redteam`: with the policy rules switched off and an agent that obeys any note it reads, 0 of 50 attacks reach release under quarantine even when the classifier always answers "safe". The `passthrough` mode stays as the comparison baseline, where the same setup lets 16 of 50 through.

**Measured on a live model (2026-11-10, `qwen2.5:32b`).** The classifier caught 50 of 50 attacks, including all 16 held-out attacks the regex missed, but flagged 4 of 16 benign notes (25%). The same model resisted all 50 attacks when it was allowed to read them, so on this model the structural guarantee costs a false-positive rate and prevents nothing observed. It is still the right default for a system where a single success is expensive, and the false-positive rate is the number to tune with real notes. See docs/evals.md.
