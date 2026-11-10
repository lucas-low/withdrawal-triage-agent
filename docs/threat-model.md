# Threat model

The system decides whether money leaves an exchange, so the main question is what happens when the model is wrong or being manipulated. Each row says what we defend against, how, and what remains.

| Threat | Defence | Residual risk |
|---|---|---|
| **Prompt injection through the note field** | Sanitised and length-bounded, delivered only inside an `untrusted` object, `NOTE_INJECTION` finding, system prompt says never to follow it | A novel phrasing slips past the heuristic. The policy floor and human review still apply |
| **Model approves something it should not** | Final action is `maxAction(agent, policyFloor)`. The model cannot loosen policy | Policy only covers the rules we wrote. A gap in rules is a gap in protection |
| **Model reads another customer's data** | Tools are bound to one withdrawal in a closure and take no ids | A bug in a tool's own lookup. Tested in `tests/triage.test.ts` |
| **Model triggers an action** | No tool mutates custody state. `proposeAction` fills a slot | None by construction, as long as no state-changing tool is ever added |
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
