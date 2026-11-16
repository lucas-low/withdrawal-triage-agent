import type { ContractFacts } from "wallet-guard";
import type { Account, Action, Proposal, ProposalStatus, Withdrawal, WithdrawalStatus } from "./domain/types";

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

/**
 * Persistence port. Synchronous on purpose: the SQLite adapter is in-process and
 * this keeps transactions simple. A networked store would make this async (see ADR 0003).
 */
export interface Repository {
  getWithdrawal(id: string): Withdrawal | undefined;
  getAccount(id: string): Account | undefined;
  /** Withdrawals by an account since `sinceIso`, excluding `excludeId`. */
  recentWithdrawals(accountId: string, sinceIso: string, excludeId: string): Withdrawal[];
  hasCompletedTo(accountId: string, address: string, excludeId: string): boolean;
  setWithdrawalStatus(id: string, status: WithdrawalStatus): void;
  listWithdrawals(filter?: { status?: WithdrawalStatus }): Withdrawal[];

  insertProposal(p: Proposal): void;
  getProposal(id: string): Proposal | undefined;
  /** Latest proposal for a withdrawal, any status. */
  latestProposalFor(withdrawalId: string): Proposal | undefined;
  listProposals(filter?: { status?: ProposalStatus }): Proposal[];
  /** Optimistic concurrency: throws a conflict if the stored version differs from `p.version - 1`. */
  updateProposal(p: Proposal): void;

  transaction<T>(fn: () => T): T;
}

export interface ExecutionRequest {
  proposalId: string;
  withdrawalId: string;
  action: Action;
  approvedBy: string[];
}

export interface ExecutionResult {
  executionId: string;
  /** False when this idempotency key was already executed. */
  firstTime: boolean;
}

/** Applies an approved action to the custody system. Idempotent per proposal. */
export interface ActionExecutor {
  execute(req: ExecutionRequest): ExecutionResult;
}

export type AuditKind =
  | "triage_started"
  | "tool_call"
  | "agent_proposal"
  | "agent_failed"
  | "policy_evaluated"
  | "proposal_created"
  | "review_decision"
  | "proposal_expired"
  | "action_executed";

export interface AuditInput {
  kind: AuditKind;
  actor: string;
  withdrawalId?: string;
  proposalId?: string;
  traceId?: string;
  data: Record<string, unknown>;
}

export interface AuditRecord extends AuditInput {
  seq: number;
  ts: string;
  prevHash: string;
  hash: string;
}

export interface AuditVerification {
  ok: boolean;
  checked: number;
  brokenAtSeq?: number;
}

export interface AuditLog {
  append(e: AuditInput): AuditRecord;
  list(filter?: { proposalId?: string; withdrawalId?: string; limit?: number }): AuditRecord[];
  verify(): AuditVerification;
}

export interface AddressFacts {
  /** True for deployed contract code. An EIP-7702 delegated EOA is not a contract. */
  isContract: boolean;
  /** Set when the account is an EOA delegating to code via EIP-7702 (code is 0xef0100 + address). */
  delegatedTo?: string;
  /** Outgoing transaction count (nonce). Zero for an address that has never sent anything. */
  txCount: number;
  balanceWei: string;
  /** Bytecode, proxy and source-verification facts for a contract, read by wallet-guard. */
  contract?: ContractFacts;
}

export interface AddressRisk {
  address: string;
  flagged: boolean;
  labels: string[];
  source: string;
  /** ok: answered. unavailable: provider failed. invalid: not a well-formed address. Policy fails closed on the last two. */
  status: "ok" | "unavailable" | "invalid";
  facts?: AddressFacts;
}

export interface ChainClient {
  addressRisk(address: string): Promise<AddressRisk>;
}

export interface Span {
  setAttributes(attrs: Record<string, unknown>): void;
}

/** A finished span. Times are epoch milliseconds. */
export interface SpanRecord {
  spanId: string;
  traceId: string;
  parentId: string | null;
  name: string;
  startMs: number;
  durationMs: number;
  status: "ok" | "error";
  attrs: Record<string, unknown>;
}

export interface SpanSink {
  export(span: SpanRecord): void;
  /** Wait for any buffered spans to be delivered. */
  flush?(): Promise<void>;
}

export interface Tracer {
  span<T>(name: string, attrs: Record<string, unknown>, fn: (span: Span) => Promise<T>): Promise<T>;
}
