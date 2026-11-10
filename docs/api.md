# HTTP API

Start with `bun run serve`. Authenticate with `Authorization: Bearer <key>`. Keys come from `API_KEYS` (`key:role:name`). Defaults for local use are in `.env.example`; replace them before exposing the server.

| Role | Can do |
|---|---|
| operator | Trigger triage, read proposals |
| reviewer | Everything an operator can, plus decide proposals and read audit |
| auditor | Read proposals and audit, verify the chain |

Errors share one shape: `{ "error": { "code": "...", "message": "..." } }`. Every response carries `x-request-id`.

| Code | HTTP | Meaning |
|---|---|---|
| `invalid_request` | 400 | Bad JSON, body over 8 KB, or failed validation |
| `unauthorized` | 401 | Missing or unknown token |
| `forbidden` | 403 | Role not allowed |
| `not_found` | 404 | Unknown id or route |
| `conflict` | 409 | Already decided, same reviewer twice, stale write, wrong withdrawal state |
| `expired` | 410 | Proposal passed its expiry |
| `rate_limited` | 429 | Triage limit (30 per minute per caller), with `retry-after` |

## Endpoints

| Method and path | Role | Notes |
|---|---|---|
| `GET /healthz` | none | Liveness |
| `GET /` | none | Review console (strict CSP, no external requests) |
| `GET /v1/withdrawals?status=pending_review` | any | |
| `POST /v1/withdrawals/:id/triage` | operator, reviewer | 201 with a new proposal, 200 with `reused: true` if one is already open |
| `GET /v1/proposals?status=pending` | any | Also expires overdue proposals |
| `GET /v1/proposals/:id` | any | |
| `POST /v1/proposals/:id/decision` | reviewer | Body `{ "decision": "approve" \| "reject", "comment"?: string }` |
| `GET /v1/proposals/:id/audit` | reviewer, auditor | |
| `GET /v1/audit/verify` | reviewer, auditor | `{ ok, checked, brokenAtSeq? }` |

## Example

```sh
curl -s -X POST localhost:3000/v1/withdrawals/w_flagged/triage -H 'authorization: Bearer dev-operator'
curl -s -X POST localhost:3000/v1/proposals/$ID/decision \
  -H 'authorization: Bearer dev-alice' -H 'content-type: application/json' \
  -d '{"decision":"approve","comment":"checked the address"}'
```
