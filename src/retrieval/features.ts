import { ACTION_RANK, type Account, type Action, type Finding, type Withdrawal } from "../domain/types";
import type { AddressRisk } from "../ports";

export interface CaseInputs {
  amountUsd: number;
  kycTier: 0 | 1 | 2;
  ageDays: number;
  limitUsd: number;
  /** Counted USD (completed or released) in the last 24h, excluding this withdrawal. */
  priorUsd: number;
  usedBefore: boolean;
  flagged: boolean;
  isContract: boolean;
  chainProblem: boolean;
  freshAddress: boolean;
  countLastHour: number;
  noteFlagged: boolean;
  blockedCountry: boolean;
  findingCount: number;
  floor: Action;
}

/** Names double as documentation of the vector layout. */
export const FEATURE_NAMES = [
  "amount",
  "kyc0",
  "kyc1",
  "kyc2",
  "accountAge",
  "limitUse",
  "usedBefore",
  "flagged",
  "isContract",
  "chainProblem",
  "freshAddress",
  "velocity",
  "noteFlagged",
  "blockedCountry",
  "findingCount",
  "floor",
] as const;

/** Heavier weights on the signals reviewers actually decide on. */
const WEIGHTS = [2, 1, 1, 1, 1, 1.5, 2, 3, 1, 1, 1, 1.5, 1.5, 2, 1, 2];

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

export function caseVector(c: CaseInputs): number[] {
  const limitUse = c.limitUsd <= 0 ? 1 : clamp01((c.priorUsd + c.amountUsd) / c.limitUsd / 2);
  const raw = [
    clamp01(Math.log10(c.amountUsd + 1) / 6),
    c.kycTier === 0 ? 1 : 0,
    c.kycTier === 1 ? 1 : 0,
    c.kycTier === 2 ? 1 : 0,
    clamp01(c.ageDays / 365),
    limitUse,
    c.usedBefore ? 1 : 0,
    c.flagged ? 1 : 0,
    c.isContract ? 1 : 0,
    c.chainProblem ? 1 : 0,
    c.freshAddress ? 1 : 0,
    clamp01(c.countLastHour / 5),
    c.noteFlagged ? 1 : 0,
    c.blockedCountry ? 1 : 0,
    clamp01(c.findingCount / 4),
    ACTION_RANK[c.floor] / 2,
  ];
  return raw.map((v, i) => v * WEIGHTS[i]!);
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * (b[i] ?? 0);
    na += a[i]! ** 2;
    nb += (b[i] ?? 0) ** 2;
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

export function inputsFromCase(args: {
  withdrawal: Withdrawal;
  account: Account;
  recent24h: Withdrawal[];
  addressRisk: AddressRisk;
  addressUsedBefore: boolean;
  noteFlagged: boolean;
  findings: Finding[];
  floor: Action;
  now: Date;
  countedStatuses: Set<string>;
}): CaseInputs {
  const { withdrawal: w, account: a, recent24h, addressRisk: r } = args;
  const hourAgo = args.now.getTime() - 3_600_000;
  return {
    amountUsd: w.amountUsd,
    kycTier: a.kycTier,
    ageDays: (args.now.getTime() - new Date(a.createdAt).getTime()) / 86_400_000,
    limitUsd: a.dailyLimitUsd,
    priorUsd: recent24h.filter((x) => args.countedStatuses.has(x.status)).reduce((s, x) => s + x.amountUsd, 0),
    usedBefore: args.addressUsedBefore,
    flagged: r.flagged,
    isContract: r.facts?.isContract ?? false,
    chainProblem: r.status !== "ok",
    freshAddress: r.facts ? r.facts.txCount === 0 && r.facts.balanceWei === "0" : false,
    countLastHour: recent24h.filter((x) => new Date(x.createdAt).getTime() >= hourAgo).length,
    noteFlagged: args.noteFlagged,
    blockedCountry: args.findings.some((f) => f.ruleId === "BLOCKED_COUNTRY"),
    findingCount: args.findings.length,
    floor: args.floor,
  };
}
