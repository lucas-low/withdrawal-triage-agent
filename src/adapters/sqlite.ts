import { Database } from "bun:sqlite";
import { conflict } from "../domain/errors";
import type { Account, Proposal, ProposalStatus, Withdrawal, WithdrawalStatus } from "../domain/types";
import type { ActionExecutor, ExecutionRequest, ExecutionResult, Repository } from "../ports";
import { newId } from "../util";

const MIGRATIONS: string[] = [
  `CREATE TABLE accounts (
     id TEXT PRIMARY KEY, kyc_tier INTEGER NOT NULL, created_at TEXT NOT NULL,
     country TEXT NOT NULL, daily_limit_usd REAL NOT NULL
   );
   CREATE TABLE withdrawals (
     id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), asset TEXT NOT NULL,
     amount_usd REAL NOT NULL, address TEXT NOT NULL, note TEXT, status TEXT NOT NULL, created_at TEXT NOT NULL
   );
   CREATE INDEX idx_withdrawals_account_time ON withdrawals(account_id, created_at);
   CREATE TABLE proposals (
     id TEXT PRIMARY KEY, withdrawal_id TEXT NOT NULL, status TEXT NOT NULL, version INTEGER NOT NULL,
     created_at TEXT NOT NULL, body TEXT NOT NULL
   );
   CREATE INDEX idx_proposals_status ON proposals(status, created_at);
   CREATE INDEX idx_proposals_withdrawal ON proposals(withdrawal_id, created_at);
   CREATE TABLE executions (
     id TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL UNIQUE, withdrawal_id TEXT NOT NULL,
     action TEXT NOT NULL, approved_by TEXT NOT NULL, executed_at TEXT NOT NULL
   );
   CREATE TABLE audit (
     seq INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, kind TEXT NOT NULL, actor TEXT NOT NULL,
     withdrawal_id TEXT, proposal_id TEXT, trace_id TEXT, data TEXT NOT NULL, prev_hash TEXT NOT NULL, hash TEXT NOT NULL
   );
   CREATE INDEX idx_audit_proposal ON audit(proposal_id);
   CREATE INDEX idx_audit_withdrawal ON audit(withdrawal_id);`,
  `CREATE TABLE spans (
     span_id TEXT PRIMARY KEY, trace_id TEXT NOT NULL, parent_id TEXT, name TEXT NOT NULL,
     start_ms REAL NOT NULL, duration_ms REAL NOT NULL, status TEXT NOT NULL, attrs TEXT NOT NULL
   );
   CREATE INDEX idx_spans_trace ON spans(trace_id, start_ms);`,
];

export function openDatabase(path: string): Database {
  const db = new Database(path, { create: true, strict: true });
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  const row = db.query("PRAGMA user_version").get() as { user_version: number };
  for (let v = row.user_version; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]!);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    })();
  }
  return db;
}

type WRow = {
  id: string;
  account_id: string;
  asset: string;
  amount_usd: number;
  address: string;
  note: string | null;
  status: WithdrawalStatus;
  created_at: string;
};
const toWithdrawal = (r: WRow): Withdrawal => ({
  id: r.id,
  accountId: r.account_id,
  asset: r.asset,
  amountUsd: r.amount_usd,
  address: r.address,
  note: r.note,
  status: r.status,
  createdAt: r.created_at,
});

export class SqliteStore implements Repository, ActionExecutor {
  constructor(
    readonly db: Database,
    private readonly nowIso: () => string = () => new Date().toISOString(),
  ) {}

  getWithdrawal(id: string) {
    const r = this.db.query("SELECT * FROM withdrawals WHERE id = ?").get(id) as WRow | null;
    return r ? toWithdrawal(r) : undefined;
  }

  getAccount(id: string): Account | undefined {
    const r = this.db.query("SELECT * FROM accounts WHERE id = ?").get(id) as {
      id: string;
      kyc_tier: 0 | 1 | 2;
      created_at: string;
      country: string;
      daily_limit_usd: number;
    } | null;
    return r ? { id: r.id, kycTier: r.kyc_tier, createdAt: r.created_at, country: r.country, dailyLimitUsd: r.daily_limit_usd } : undefined;
  }

  recentWithdrawals(accountId: string, sinceIso: string, excludeId: string) {
    const rows = this.db
      .query("SELECT * FROM withdrawals WHERE account_id = ? AND created_at >= ? AND id != ? ORDER BY created_at")
      .all(accountId, sinceIso, excludeId) as WRow[];
    return rows.map(toWithdrawal);
  }

  hasCompletedTo(accountId: string, address: string, excludeId: string) {
    const r = this.db
      .query(
        "SELECT 1 AS x FROM withdrawals WHERE account_id = ? AND address = ? AND status IN ('completed','released') AND id != ? LIMIT 1",
      )
      .get(accountId, address, excludeId);
    return r !== null;
  }

  setWithdrawalStatus(id: string, status: WithdrawalStatus) {
    this.db.query("UPDATE withdrawals SET status = ? WHERE id = ?").run(status, id);
  }

  listWithdrawals(filter: { status?: WithdrawalStatus } = {}) {
    const rows = (
      filter.status
        ? this.db.query("SELECT * FROM withdrawals WHERE status = ? ORDER BY created_at").all(filter.status)
        : this.db.query("SELECT * FROM withdrawals ORDER BY created_at").all()
    ) as WRow[];
    return rows.map(toWithdrawal);
  }

  insertAccount(a: Account) {
    this.db.query("INSERT INTO accounts VALUES (?, ?, ?, ?, ?)").run(a.id, a.kycTier, a.createdAt, a.country, a.dailyLimitUsd);
  }

  insertWithdrawal(w: Withdrawal) {
    this.db
      .query("INSERT INTO withdrawals VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(w.id, w.accountId, w.asset, w.amountUsd, w.address, w.note, w.status, w.createdAt);
  }

  insertProposal(p: Proposal) {
    this.db
      .query("INSERT INTO proposals (id, withdrawal_id, status, version, created_at, body) VALUES (?, ?, ?, ?, ?, ?)")
      .run(p.id, p.withdrawalId, p.status, p.version, p.createdAt, JSON.stringify(p));
  }

  getProposal(id: string) {
    const r = this.db.query("SELECT body FROM proposals WHERE id = ?").get(id) as { body: string } | null;
    return r ? (JSON.parse(r.body) as Proposal) : undefined;
  }

  latestProposalFor(withdrawalId: string) {
    const r = this.db
      .query("SELECT body FROM proposals WHERE withdrawal_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1")
      .get(withdrawalId) as { body: string } | null;
    return r ? (JSON.parse(r.body) as Proposal) : undefined;
  }

  listProposals(filter: { status?: ProposalStatus } = {}) {
    const rows = (
      filter.status
        ? this.db.query("SELECT body FROM proposals WHERE status = ? ORDER BY created_at, rowid").all(filter.status)
        : this.db.query("SELECT body FROM proposals ORDER BY created_at, rowid").all()
    ) as { body: string }[];
    return rows.map((r) => JSON.parse(r.body) as Proposal);
  }

  updateProposal(p: Proposal) {
    const res = this.db
      .query("UPDATE proposals SET status = ?, version = ?, body = ? WHERE id = ? AND version = ?")
      .run(p.status, p.version, JSON.stringify(p), p.id, p.version - 1);
    if (res.changes === 0) throw conflict(`proposal ${p.id} was modified concurrently`);
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  execute(req: ExecutionRequest): ExecutionResult {
    const key = `proposal:${req.proposalId}`;
    const existing = this.db.query("SELECT id FROM executions WHERE idempotency_key = ?").get(key) as { id: string } | null;
    if (existing) return { executionId: existing.id, firstTime: false };
    const id = newId("exec");
    this.db
      .query("INSERT INTO executions VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, key, req.withdrawalId, req.action, req.approvedBy.join(","), this.nowIso());
    const status: WithdrawalStatus = req.action === "release" ? "released" : req.action === "hold" ? "held" : "escalated";
    this.setWithdrawalStatus(req.withdrawalId, status);
    return { executionId: id, firstTime: true };
  }
}
