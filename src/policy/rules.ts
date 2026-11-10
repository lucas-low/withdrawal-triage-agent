import type { Account, Action, Finding, Withdrawal } from "../domain/types";
import type { InjectionResult } from "../guardrails/injection";
import type { AddressRisk } from "../ports";

export interface PolicyConfig {
  newAccountDays: number;
  newAccountLargeUsd: number;
  newAddressLargeUsd: number;
  velocityWindowMinutes: number;
  velocityMax: number;
  blockedCountries: string[];
  fourEyesUsd: number;
  /** Rule ids to skip. Only used by evals that simulate a gap in the rules. */
  disabledRules: string[];
}

export const DEFAULT_POLICY: PolicyConfig = {
  newAccountDays: 7,
  newAccountLargeUsd: 1_000,
  newAddressLargeUsd: 10_000,
  velocityWindowMinutes: 60,
  velocityMax: 5,
  blockedCountries: ["KP", "IR"],
  fourEyesUsd: 25_000,
  disabledRules: [],
};

export interface PolicyContext {
  withdrawal: Withdrawal;
  account: Account;
  /** Other withdrawals by this account in the last 24 hours. */
  recent24h: Withdrawal[];
  addressRisk: AddressRisk;
  addressUsedBefore: boolean;
  injection: InjectionResult;
  now: Date;
  config: PolicyConfig;
}

export interface Rule {
  id: string;
  description: string;
  evaluate(ctx: PolicyContext): Finding | null;
}

const finding = (ruleId: string, action: Action, message: string, evidence: Record<string, unknown> = {}): Finding => ({
  ruleId,
  action,
  message,
  evidence,
});

/** Statuses that count against the daily limit: money that has moved or been committed. Pending, held and escalated do not. */
export const COUNTED_STATUSES = new Set(["completed", "released"]);

export const RULES: Rule[] = [
  {
    id: "KYC_TIER_0",
    description: "Accounts that have not completed KYC cannot withdraw.",
    evaluate: ({ account }) =>
      account.kycTier === 0 ? finding("KYC_TIER_0", "hold", "Account has not completed KYC.", { kycTier: 0 }) : null,
  },
  {
    id: "OVER_DAILY_LIMIT",
    description: "Amount plus the last 24h of counted withdrawals exceeds the account's daily limit.",
    evaluate: ({ withdrawal, account, recent24h }) => {
      const prior = recent24h.filter((w) => COUNTED_STATUSES.has(w.status)).reduce((s, w) => s + w.amountUsd, 0);
      const total = prior + withdrawal.amountUsd;
      return total > account.dailyLimitUsd
        ? finding("OVER_DAILY_LIMIT", "hold", `24h total ${total} exceeds limit ${account.dailyLimitUsd}.`, {
            priorUsd: prior,
            amountUsd: withdrawal.amountUsd,
            limitUsd: account.dailyLimitUsd,
          })
        : null;
    },
  },
  {
    id: "CHAIN_DATA_UNAVAILABLE",
    description: "Chain analytics could not answer, so the address was not checked.",
    evaluate: ({ addressRisk }) =>
      addressRisk.status === "unavailable"
        ? finding("CHAIN_DATA_UNAVAILABLE", "hold", "Chain data provider unavailable; address not checked.", { source: addressRisk.source })
        : null,
  },
  {
    id: "INVALID_ADDRESS",
    description: "Destination is not a well-formed address.",
    evaluate: ({ addressRisk }) =>
      addressRisk.status === "invalid"
        ? finding("INVALID_ADDRESS", "hold", "Destination address is malformed.", { address: addressRisk.address })
        : null,
  },
  {
    id: "FLAGGED_ADDRESS",
    description: "Destination address is flagged by chain analytics.",
    evaluate: ({ addressRisk }) =>
      addressRisk.flagged
        ? finding("FLAGGED_ADDRESS", "escalate", `Destination flagged: ${addressRisk.labels.join(", ")}.`, {
            labels: addressRisk.labels,
            source: addressRisk.source,
          })
        : null,
  },
  {
    id: "BLOCKED_COUNTRY",
    description: "Account country is on the blocked list.",
    evaluate: ({ account, config }) =>
      config.blockedCountries.includes(account.country)
        ? finding("BLOCKED_COUNTRY", "escalate", `Account country ${account.country} is blocked.`, { country: account.country })
        : null,
  },
  {
    id: "NEW_ACCOUNT_LARGE",
    description: "Young account withdrawing a large amount.",
    evaluate: ({ withdrawal, account, now, config }) => {
      const ageDays = (now.getTime() - new Date(account.createdAt).getTime()) / 86_400_000;
      return ageDays < config.newAccountDays && withdrawal.amountUsd > config.newAccountLargeUsd
        ? finding("NEW_ACCOUNT_LARGE", "hold", `Account is ${ageDays.toFixed(1)} days old and withdraws ${withdrawal.amountUsd}.`, {
            ageDays: Number(ageDays.toFixed(2)),
            amountUsd: withdrawal.amountUsd,
          })
        : null;
    },
  },
  {
    id: "NEW_ADDRESS_LARGE",
    description: "First withdrawal to this address and the amount is large.",
    evaluate: ({ withdrawal, addressUsedBefore, config }) =>
      !addressUsedBefore && withdrawal.amountUsd > config.newAddressLargeUsd
        ? finding("NEW_ADDRESS_LARGE", "hold", "First withdrawal to this address and amount is large.", { amountUsd: withdrawal.amountUsd })
        : null,
  },
  {
    id: "VELOCITY",
    description: "Too many withdrawals in a short window.",
    evaluate: ({ recent24h, now, config }) => {
      const cutoff = now.getTime() - config.velocityWindowMinutes * 60_000;
      const count = recent24h.filter((w) => new Date(w.createdAt).getTime() >= cutoff).length + 1;
      return count > config.velocityMax
        ? finding("VELOCITY", "hold", `${count} withdrawals in ${config.velocityWindowMinutes} minutes.`, {
            count,
            windowMinutes: config.velocityWindowMinutes,
          })
        : null;
    },
  },
  {
    id: "NOTE_INJECTION",
    description: "The free-text note looks like an attempt to instruct the system.",
    evaluate: ({ injection }) =>
      injection.detected
        ? finding("NOTE_INJECTION", "escalate", "Note contains instruction-like text.", { patterns: injection.matches })
        : null,
  },
];
