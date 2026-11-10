import type { Database } from "bun:sqlite";
import type { Action } from "../domain/types";
import { cosine } from "./features";

export interface Precedent {
  id: string;
  vector: number[];
  /** What the system proposed. */
  proposedAction: Action;
  /** What the humans did with it. */
  outcome: "approved" | "rejected";
  ruleIds: string[];
  amountUsd: number;
  /** The few facts a reader needs to judge how comparable the case is. */
  profile: { kycTier: 0 | 1 | 2; usedBefore: boolean };
  decidedAt: string;
  source: "review" | "seed";
}

export interface SimilarCase {
  similarity: number;
  proposedAction: Action;
  outcome: "approved" | "rejected";
  ruleIds: string[];
  amountUsd: number;
  profile: { kycTier: 0 | 1 | 2; usedBefore: boolean };
}

export interface PrecedentStore {
  add(p: Precedent): void;
  search(vector: number[], k: number, minSimilarity?: number): SimilarCase[];
  count(): number;
}

/**
 * Case-based retrieval over past reviewer decisions. Brute-force cosine similarity over stored vectors.
 * That is fine to roughly ten thousand cases; past that, move to pgvector with an HNSW index (docs/roadmap.md).
 * Only structured fields are stored and returned. Reviewer comments are deliberately left out so retrieved
 * text can never carry an instruction to the agent.
 */
export class SqlitePrecedentStore implements PrecedentStore {
  constructor(private readonly db: Database) {}

  add(p: Precedent) {
    this.db
      .query(
        "INSERT OR REPLACE INTO precedents (id, vector, proposed_action, outcome, rule_ids, amount_usd, profile, decided_at, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        p.id,
        JSON.stringify(p.vector),
        p.proposedAction,
        p.outcome,
        JSON.stringify(p.ruleIds),
        p.amountUsd,
        JSON.stringify(p.profile),
        p.decidedAt,
        p.source,
      );
  }

  count() {
    return (this.db.query("SELECT COUNT(*) AS n FROM precedents").get() as { n: number }).n;
  }

  search(vector: number[], k: number, minSimilarity = 0.8): SimilarCase[] {
    const rows = this.db.query("SELECT * FROM precedents").all() as {
      vector: string;
      proposed_action: Action;
      outcome: "approved" | "rejected";
      rule_ids: string;
      amount_usd: number;
      profile: string;
    }[];
    return rows
      .map((r) => ({
        similarity: cosine(vector, JSON.parse(r.vector)),
        proposedAction: r.proposed_action,
        outcome: r.outcome,
        ruleIds: JSON.parse(r.rule_ids) as string[],
        amountUsd: r.amount_usd,
        profile: JSON.parse(r.profile) as Precedent["profile"],
      }))
      .filter((r) => r.similarity >= minSimilarity)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, k)
      .map((r) => ({ ...r, similarity: Number(r.similarity.toFixed(3)) }));
  }
}
