# 0004. Hash-chained audit log

**Status:** accepted

**Context.** Reviewers and regulators need to trust that the record of who decided what was not edited.

**Decision.** Each audit row stores `prevHash` and `hash = sha256(canonical JSON of the row, including prevHash)`. `verify()` walks the chain and reports the first broken sequence number.

**Consequences.** Edits and deletions of individual rows are detected. Rewriting the entire chain is not, so the head hash should be anchored outside the database (roadmap). Canonical JSON with sorted keys keeps hashes stable across serialisation.
