import type { Database } from "bun:sqlite";
import type { AuditInput, AuditLog, AuditRecord, AuditVerification } from "../ports";
import { canonicalJson, sha256 } from "../util";

export const GENESIS_HASH = "0".repeat(64);

type Row = {
  seq: number;
  ts: string;
  kind: AuditRecord["kind"];
  actor: string;
  withdrawal_id: string | null;
  proposal_id: string | null;
  trace_id: string | null;
  data: string;
  prev_hash: string;
  hash: string;
};

const toRecord = (r: Row): AuditRecord => ({
  seq: r.seq,
  ts: r.ts,
  kind: r.kind,
  actor: r.actor,
  withdrawalId: r.withdrawal_id ?? undefined,
  proposalId: r.proposal_id ?? undefined,
  traceId: r.trace_id ?? undefined,
  data: JSON.parse(r.data),
  prevHash: r.prev_hash,
  hash: r.hash,
});

export function hashRecord(r: Omit<AuditRecord, "hash">): string {
  return sha256(
    canonicalJson({
      seq: r.seq,
      ts: r.ts,
      kind: r.kind,
      actor: r.actor,
      withdrawalId: r.withdrawalId ?? null,
      proposalId: r.proposalId ?? null,
      traceId: r.traceId ?? null,
      data: r.data,
      prevHash: r.prevHash,
    }),
  );
}

/** Append-only log where each record commits to the previous one, so edits and deletions are detectable. */
export class SqliteAuditLog implements AuditLog {
  constructor(
    private readonly db: Database,
    private readonly nowIso: () => string = () => new Date().toISOString(),
  ) {}

  append(e: AuditInput): AuditRecord {
    return this.db.transaction(() => {
      const last = this.db.query("SELECT seq, hash FROM audit ORDER BY seq DESC LIMIT 1").get() as { seq: number; hash: string } | null;
      const base: Omit<AuditRecord, "hash"> = {
        ...e,
        seq: (last?.seq ?? 0) + 1,
        ts: this.nowIso(),
        prevHash: last?.hash ?? GENESIS_HASH,
      };
      const rec: AuditRecord = { ...base, hash: hashRecord(base) };
      this.db
        .query(
          "INSERT INTO audit (seq, ts, kind, actor, withdrawal_id, proposal_id, trace_id, data, prev_hash, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          rec.seq,
          rec.ts,
          rec.kind,
          rec.actor,
          rec.withdrawalId ?? null,
          rec.proposalId ?? null,
          rec.traceId ?? null,
          canonicalJson(rec.data),
          rec.prevHash,
          rec.hash,
        );
      return rec;
    })();
  }

  list(filter: { proposalId?: string; withdrawalId?: string; limit?: number } = {}): AuditRecord[] {
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (filter.proposalId) {
      where.push("proposal_id = ?");
      args.push(filter.proposalId);
    }
    if (filter.withdrawalId) {
      where.push("withdrawal_id = ?");
      args.push(filter.withdrawalId);
    }
    const sql = `SELECT * FROM audit ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY seq ${filter.limit ? "DESC LIMIT ?" : ""}`;
    if (filter.limit) args.push(filter.limit);
    const rows = this.db.query(sql).all(...args) as Row[];
    const recs = rows.map(toRecord);
    return filter.limit ? recs.reverse() : recs;
  }

  verify(): AuditVerification {
    let prev = GENESIS_HASH;
    let expectedSeq = 1;
    let checked = 0;
    for (const row of this.db.query("SELECT * FROM audit ORDER BY seq").iterate() as Iterable<Row>) {
      const rec = toRecord(row);
      const { hash, ...rest } = rec;
      if (rec.seq !== expectedSeq || rec.prevHash !== prev || hashRecord(rest) !== hash) {
        return { ok: false, checked, brokenAtSeq: rec.seq };
      }
      prev = hash;
      expectedSeq++;
      checked++;
    }
    return { ok: true, checked };
  }
}
