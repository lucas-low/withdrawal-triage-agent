#!/usr/bin/env bun
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { loadTrace } from "../adapters/tracer";
import { loadConfig } from "../config";
import { createApp } from "../container";
import { ensureDemoData } from "../demo";
import { AppError } from "../domain/errors";
import type { Principal } from "../domain/types";
import { seed } from "../seed";
import { createHandler } from "../server/app";
import { actionColor, bold, dim, formatProposal, green, red, table } from "./format";

const HELP = `withdrawal-triage: an AI agent proposes, a human decides

Usage: bun run cli <command> [options]

  seed                          create demo accounts and withdrawals (empty database only)
  queue                         pending withdrawals and open proposals
  triage <withdrawalId>         run the agent and policy engine, create a proposal
  triage --all                  triage every pending_review withdrawal
  review --as <reviewer>        walk the pending proposals and approve or reject each
  decide <proposalId> <approve|reject> --as <reviewer> [--comment "..."]
  show <proposalId>             proposal detail and its audit trail
  chain <address>               what the chain client reports (OFAC list + on-chain facts when CHAIN_PROVIDER=onchain)
  trace <proposalId|traceId>    span tree with timings, token use and errors
  audit verify                  check the hash chain
  expire                        mark overdue proposals expired
  serve                         start the HTTP API and review console

Environment: see .env.example. MODEL_PROVIDER defaults to mock, so no API key is needed.`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { all: { type: "boolean" }, as: { type: "string" }, comment: { type: "string" }, help: { type: "boolean", short: "h" } },
});
const [command, ...rest] = positionals;

async function main() {
  if (!command || values.help || command === "help") return console.log(HELP);
  const config = loadConfig();
  const app = createApp(config);

  const reviewer = (): Principal => {
    const name = values.as;
    if (!name) throw new AppError("invalid_request", "--as <reviewer> is required");
    const p = [...config.apiKeys.values()].find((x) => x.name === name);
    if (!p) throw new AppError("invalid_request", `unknown reviewer "${name}"`);
    return p;
  };

  switch (command) {
    case "seed": {
      if (app.store.listWithdrawals().length > 0) throw new AppError("conflict", `${config.dbPath} already has data`);
      seed(app.store);
      console.log(green(`Seeded ${config.dbPath}. Pin the demo clock with CLOCK_PIN=2026-11-10T03:00:00.000Z for stable results.`));
      return;
    }
    case "queue": {
      app.review.expireOverdue();
      const pendingW = app.store.listWithdrawals({ status: "pending_review" });
      const open = new Map(app.store.listProposals({ status: "pending" }).map((p) => [p.withdrawalId, p]));
      if (!pendingW.length) return console.log(dim("No withdrawals pending review."));
      console.log(
        table([
          ["WITHDRAWAL", "USD", "ASSET", "PROPOSAL"],
          ...pendingW.map((w) => [
            w.id,
            String(w.amountUsd),
            w.asset,
            open.get(w.id) ? `${open.get(w.id)!.id} ${actionColor(open.get(w.id)!.finalAction)}` : dim("not triaged"),
          ]),
        ]),
      );
      return;
    }
    case "triage": {
      const ids = values.all ? app.store.listWithdrawals({ status: "pending_review" }).map((w) => w.id) : rest;
      if (!ids.length) throw new AppError("invalid_request", "give a withdrawal id or --all");
      for (const id of ids) {
        const { proposal, reused } = await app.triage.triage(id, process.env.USER ?? "cli");
        console.log(`${formatProposal(proposal)}${reused ? dim("\n  (existing open proposal)") : ""}\n`);
      }
      await app.tracer.flush();
      return;
    }
    case "review": {
      const who = reviewer();
      app.review.expireOverdue();
      const pending = app.store.listProposals({ status: "pending" }).filter((p) => !p.approvals.some((a) => a.reviewer === who.name));
      if (!pending.length) return console.log(dim("Nothing waiting for you."));
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      for (const p of pending) {
        console.log(`\n${formatProposal(p)}`);
        const a = (await rl.question(bold("[a]pprove / [r]eject / [s]kip / [q]uit > "))).trim().toLowerCase();
        if (a === "q") break;
        if (a !== "a" && a !== "r") continue;
        const comment = (await rl.question("comment (optional) > ")).trim() || undefined;
        const r = app.review.decide(p.id, who, { decision: a === "a" ? "approve" : "reject", comment });
        console.log(r.executed ? green(`Executed ${r.proposal.finalAction}`) : `Recorded, status ${r.proposal.status}`);
      }
      rl.close();
      return;
    }
    case "decide": {
      const [id, d] = rest;
      if (!id || (d !== "approve" && d !== "reject"))
        throw new AppError("invalid_request", "usage: decide <proposalId> <approve|reject> --as <reviewer>");
      const r = app.review.decide(id, reviewer(), { decision: d, comment: values.comment });
      console.log(formatProposal(r.proposal));
      if (r.executed) console.log(green(`\nExecuted ${r.proposal.finalAction} (${r.executed.executionId})`));
      return;
    }
    case "show": {
      const p = app.store.getProposal(rest[0] ?? "");
      if (!p) throw new AppError("not_found", `proposal ${rest[0]} not found`);
      console.log(formatProposal(p));
      console.log(`\n${bold("Audit trail")}`);
      console.log(
        table([
          ["SEQ", "TIME", "KIND", "ACTOR"],
          ...app.audit.list({ proposalId: p.id }).map((r) => [String(r.seq), r.ts, r.kind, r.actor]),
        ]),
      );
      return;
    }
    case "chain": {
      if (!rest[0]) throw new AppError("invalid_request", "usage: chain <address>");
      const { OnchainChainClient, loadSanctionList } = await import("wallet-guard");
      const client = new OnchainChainClient(loadSanctionList(config.ofacListPath), { url: config.ethRpcUrl });
      console.log(JSON.stringify(await client.addressRisk(rest[0]), null, 2));
      return;
    }
    case "trace": {
      const arg = rest[0] ?? "";
      const traceId = app.store.getProposal(arg)?.traceId ?? arg;
      const spans = loadTrace(app.db, traceId);
      if (!spans.length) throw new AppError("not_found", `no spans for ${arg}`);
      const children = (parent: string | null) => spans.filter((s) => s.parentId === parent);
      const t0 = spans[0]!.startMs;
      const walk = (parent: string | null, depth: number) => {
        for (const sp of children(parent)) {
          const extra = ["gen_ai.usage.input_tokens", "gen_ai.usage.output_tokens", "steps", "finalAction", "error", "agentError"]
            .filter((k) => sp.attrs[k] !== undefined)
            .map((k) => `${k.replace("gen_ai.usage.", "")}=${sp.attrs[k]}`)
            .join(" ");
          console.log(
            `${" ".repeat(depth * 2)}${sp.status === "ok" ? "" : red("! ")}${sp.name}  +${Math.round(sp.startMs - t0)}ms  ${sp.durationMs}ms  ${dim(extra)}`,
          );
          walk(sp.spanId, depth + 1);
        }
      };
      console.log(`${bold("trace")} ${traceId}`);
      walk(null, 0);
      return;
    }
    case "audit": {
      if (rest[0] !== "verify") throw new AppError("invalid_request", "usage: audit verify");
      const v = app.audit.verify();
      console.log(v.ok ? green(`Audit chain intact (${v.checked} records).`) : red(`AUDIT CHAIN BROKEN at record ${v.brokenAtSeq}`));
      process.exitCode = v.ok ? 0 : 2;
      return;
    }
    case "expire":
      return console.log(`Expired ${app.review.expireOverdue()} proposal(s).`);
    case "serve": {
      if (config.demoMode) ensureDemoData(app);
      const server = Bun.serve({ port: config.port, fetch: createHandler(app) });
      console.log(
        `Review console on http://localhost:${server.port}  (model: ${config.modelProvider === "mock" ? `mock/${config.mockBehavior}` : config.model})`,
      );
      return new Promise(() => {});
    }
    default:
      throw new AppError("invalid_request", `unknown command "${command}"\n\n${HELP}`);
  }
}

main().catch((err) => {
  console.error(red(err instanceof AppError ? `${err.code}: ${err.message}` : String(err)));
  process.exit(err instanceof AppError && err.code !== "config" ? 1 : 2);
});
