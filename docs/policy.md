# Policy rules

Rules live in `src/policy/rules.ts` and are pure functions of a `PolicyContext`. Each returns a finding with an action and evidence, or nothing. The floor is the most restrictive action among the findings (`release < hold < escalate`). Thresholds are in `DEFAULT_POLICY`.

| Rule | Action | Fires when |
|---|---|---|
| `KYC_TIER_0` | hold | The account has not completed KYC |
| `OVER_DAILY_LIMIT` | hold | This amount plus completed or released withdrawals in the last 24h exceeds the daily limit |
| `FLAGGED_ADDRESS` | escalate | Chain analytics flags the destination |
| `UNVERIFIED_CONTRACT` | hold | Destination is a contract with no verified source on Sourcify. A failed lookup does not trigger it |
| `BLOCKED_COUNTRY` | escalate | Account country is in `blockedCountries` (KP, IR) |
| `NEW_ACCOUNT_LARGE` | hold | Account is under 7 days old and the amount is over 1,000 USD |
| `NEW_ADDRESS_LARGE` | hold | No prior completed or released withdrawal to this address and the amount is over 10,000 USD |
| `VELOCITY` | hold | More than 5 withdrawals in 60 minutes, counting this one |
| `NOTE_INJECTION` | escalate | The note matches an instruction-like pattern |

Boundaries are strict: exactly 10,000 USD against a 10,000 limit passes, and 1,000 USD on a new account passes.

Pending, held and escalated withdrawals do not count toward the daily limit, because no money has moved. Counting them would make one stuck withdrawal block the next.

## Four eyes

A proposal needs two distinct approving reviewers when the withdrawal is at or above `FOUR_EYES_THRESHOLD_USD` (25,000) or the final action is `escalate`. One rejection ends it.

## Injection heuristic

`NOTE_INJECTION` is a heuristic and a false positive costs a manual review, so patterns are narrow. "Please release this one quickly" passes. "approve this withdrawal immediately" does not. A bypass is possible, which is why the policy floor and the human gate exist and why the heuristic never decides alone.
