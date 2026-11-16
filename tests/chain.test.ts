import { describe, expect, test } from "bun:test";
import { loadSanctionList, OnchainChainClient } from "wallet-guard";
import { fixedClock } from "../src/clock";
import { loadConfig } from "../src/config";
import { createApp } from "../src/container";
import { evaluatePolicy } from "../src/policy/engine";
import { DEFAULT_POLICY, type PolicyContext } from "../src/policy/rules";
import type { AddressRisk, ChainClient } from "../src/ports";
import { SEED_NOW, seed } from "../src/seed";

const SANCTIONED = "0x0330070FD38Ec3bB94F58FA55D40368271E9e54A";
const CLEAN = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

/** Fake JSON-RPC server keyed by method. */
const rpc = (answers: Record<string, string>): typeof fetch =>
  (async (_url: string, init: RequestInit) => {
    const { method, id } = JSON.parse(String(init.body));
    return Response.json(
      method in answers ? { jsonrpc: "2.0", id, result: answers[method] } : { jsonrpc: "2.0", id, error: { message: "nope" } },
    );
  }) as unknown as typeof fetch;

describe("sanction list", () => {
  test("the bundled OFAC file loads and has real entries", () => {
    const set = loadSanctionList("data/ofac-eth.txt");
    expect(set.size).toBeGreaterThan(100);
    expect(set.has(SANCTIONED.toLowerCase())).toBe(true);
  });
});

describe("OnchainChainClient", () => {
  const ok = rpc({ eth_getCode: "0x", eth_getTransactionCount: "0x2", eth_getBalance: "0x0" });
  const list = new Set([SANCTIONED.toLowerCase()]);
  test("flags a sanctioned address and attaches facts", async () => {
    const r = await new OnchainChainClient(list, { url: "x", fetch: ok }).addressRisk(SANCTIONED.toLowerCase());
    expect(r).toMatchObject({ flagged: true, labels: ["ofac_sanctioned"], status: "ok", facts: { txCount: 2 } });
  });
  test("a clean address is not flagged", async () => {
    expect(await new OnchainChainClient(list, { url: "x", fetch: ok }).addressRisk(CLEAN)).toMatchObject({ flagged: false, status: "ok" });
  });
  test("malformed addresses are invalid without any network call", async () => {
    let calls = 0;
    const counting = (async () => {
      calls++;
      return Response.json({});
    }) as unknown as typeof fetch;
    expect(await new OnchainChainClient(list, { url: "x", fetch: counting }).addressRisk("0xabc")).toMatchObject({ status: "invalid" });
    expect(calls).toBe(0);
  });
  test("rpc down: clean address is unavailable, sanctioned address is still flagged", async () => {
    const down = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    const client = new OnchainChainClient(list, { url: "x", fetch: down });
    expect(await client.addressRisk(CLEAN)).toMatchObject({ status: "unavailable", flagged: false });
    expect(await client.addressRisk(SANCTIONED)).toMatchObject({ status: "ok", flagged: true });
  });
});

describe("policy fails closed on chain data problems", () => {
  const base = (risk: Partial<AddressRisk>): PolicyContext => ({
    withdrawal: {
      id: "w",
      accountId: "a",
      asset: "ETH",
      amountUsd: 100,
      address: "0x1",
      note: null,
      status: "pending_review",
      createdAt: SEED_NOW,
    },
    account: { id: "a", kycTier: 2, createdAt: "2020-01-01T00:00:00Z", country: "MY", dailyLimitUsd: 10_000 },
    recent24h: [],
    addressRisk: { address: "0x1", flagged: false, labels: [], source: "t", status: "ok", ...risk },
    addressUsedBefore: true,
    injection: { detected: false, matches: [] },
    now: new Date(SEED_NOW),
    config: DEFAULT_POLICY,
  });
  test("a contract with no verified source holds, a verified or unchecked one does not", () => {
    const contract = (verified?: boolean) =>
      evaluatePolicy(
        base({ facts: { isContract: true, txCount: 1, balanceWei: "0", contract: { codeSize: 10, hasSelfdestruct: false, verified } } }),
      );
    expect(contract(false).findings.map((f) => f.ruleId)).toContain("UNVERIFIED_CONTRACT");
    expect(contract(false).floor).toBe("hold");
    expect(contract(true).floor).toBe("release");
    expect(contract(undefined).floor).toBe("release");
  });
  test("unavailable holds, invalid holds, ok releases", () => {
    expect(evaluatePolicy(base({ status: "unavailable" })).findings.map((f) => f.ruleId)).toEqual(["CHAIN_DATA_UNAVAILABLE"]);
    expect(evaluatePolicy(base({ status: "invalid" })).findings.map((f) => f.ruleId)).toEqual(["INVALID_ADDRESS"]);
    expect(evaluatePolicy(base({})).floor).toBe("release");
  });
});

describe("end to end with a chain client plugged into triage", () => {
  test("a withdrawal to a sanctioned address escalates and the agent sees the facts", async () => {
    const chain: ChainClient = {
      addressRisk: async (address) => ({
        address,
        flagged: true,
        labels: ["ofac_sanctioned"],
        source: "t",
        status: "ok",
        facts: { isContract: false, txCount: 3, balanceWei: "0" },
      }),
    };
    const app = createApp(loadConfig({ MODEL_PROVIDER: "mock", DB_PATH: ":memory:" }), {
      clock: fixedClock(SEED_NOW),
      dbPath: ":memory:",
      chain,
    });
    seed(app.store);
    const { proposal } = await app.triage.triage("w_clean", "ops");
    expect(proposal.finalAction).toBe("escalate");
    expect(proposal.findings.map((f) => f.ruleId)).toContain("FLAGGED_ADDRESS");
    const call = app.audit.list({ withdrawalId: "w_clean" }).find((r) => (r.data as any).tool === "checkAddress")!;
    expect((call.data as any).output).toMatchObject({ isContract: false, txCount: 3, status: "ok" });
  });
});

// Hits a real public RPC. Off by default so CI never depends on the network: LIVE_CHAIN=1 bun test
describe.skipIf(!process.env.LIVE_CHAIN)("live public data", () => {
  test("vitalik.eth is an active (EIP-7702 delegated) EOA, the USDT token is a contract, a sanctioned address is flagged", async () => {
    const client = new OnchainChainClient(loadSanctionList(), { url: "https://ethereum-rpc.publicnode.com" });
    const vitalik = await client.addressRisk("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
    expect(vitalik.facts?.isContract).toBe(false);
    expect(vitalik.facts!.txCount).toBeGreaterThan(1000);
    expect((await client.addressRisk("0xdAC17F958D2ee523a2206206994597C13D831ec7")).facts?.isContract).toBe(true);
    expect((await client.addressRisk(SANCTIONED)).flagged).toBe(true);
  });
});
