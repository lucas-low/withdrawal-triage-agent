# Threat model

The system decides whether money leaves an exchange, so the main question is what happens when the model is wrong or being manipulated. Each row says what we defend against, how, and what remains.

| Threat | Defence | Residual risk |
|---|---|---|
| **Prompt injection through the note field** | Quarantine: the agent never sees the note. A tool-less classifier returns one boolean (fail closed on error). Regex screen as an extra signal. See ADR 0006 | The classifier can be fooled into saying "safe", which only removes an extra escalation. Measured: 0 of 50 attacks steer the agent. The regex alone caught 1 of 16 unseen attacks |
| **Model approves something it should not** | Final action is `maxAction(agent, policyFloor)`. The model cannot loosen policy | Policy only covers the rules we wrote. A gap in rules is a gap in protection |
| **Model reads another customer's data** | Tools are bound to one withdrawal in a closure and take no ids | A bug in a tool's own lookup. Tested in `tests/triage.test.ts` |
| **Model triggers an action** | No tool mutates custody state. `proposeAction` fills a slot | None by construction, as long as no state-changing tool is ever added |
| **Poisoned precedents steer the agent** | Only structured fields are stored, no reviewer text. Only human-decided proposals are added. The policy floor still bounds the outcome | A malicious reviewer who rejects or approves en masse can shift retrieval. Two-person approval limits this for large amounts |
| **Chain data provider lies or fails** | Provider errors return `unavailable` and policy holds. The OFAC list is local, so a sanctioned address is flagged even when the RPC is down. Malformed addresses are held | A provider returning wrong facts. Use more than one source in production |
| **Model hangs, errors or stays silent** | Step cap, wall-clock timeout, fail-closed `hold`, proposal marked `degraded` | Availability: a dead model means every withdrawal needs a human |
| **Reviewer impersonation or role abuse** | Bearer keys map to named roles. Only `reviewer` can decide. Same reviewer cannot approve twice | Static keys in env. See roadmap for SSO |
| **Single reviewer collusion or error on large amounts** | Two distinct approvals at 25k USD or for escalations | Two colluding reviewers |
| **Replay or double execution** | Idempotency key per proposal with a unique index, status checks, optimistic versioning | None known |
| **Stale approval** | Proposals expire after `PROPOSAL_TTL_MS` and cannot be approved afterwards | Clock skew on the host |
| **Audit tampering** | Hash chain over every record. `audit verify` finds edits and deletions | Someone with database write access can rewrite the whole chain. Anchor the head hash externally (roadmap) |
| **Secrets in config** | Anthropic key only via env, never logged. `.env` is git-ignored | |
| **XSS in the review console** | All dynamic text uses `textContent`. CSP is `default-src 'none'` with no external connections | Inline script is allowed by CSP, so any future template change must keep `textContent` |
| **Abuse of the triage endpoint** | Per-caller rate limit, 8 KB body cap | Limiter is per process |
| **Cost blowout from a looping model** | `AGENT_MAX_STEPS`, timeout, one retry | No spend cap yet |

Out of scope for now: real custody integration, chain-data poisoning, and network-level concerns (TLS termination is expected in front of the server).
