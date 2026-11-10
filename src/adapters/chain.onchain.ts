import { readFileSync } from "node:fs";
import type { AddressFacts, AddressRisk, ChainClient } from "../ports";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export function parseSanctionList(text: string): Set<string> {
  return new Set(
    text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => ADDRESS_RE.test(l))
      .map((l) => l.toLowerCase()),
  );
}

export function loadSanctionList(path = "data/ofac-eth.txt"): Set<string> {
  return parseSanctionList(readFileSync(path, "utf8"));
}

export interface RpcOptions {
  url: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

/** Reads public facts about an address from any Ethereum JSON-RPC endpoint. */
export async function readAddressFacts(address: string, opts: RpcOptions): Promise<AddressFacts> {
  const doFetch = opts.fetch ?? fetch;
  const call = async (id: number, method: string, params: unknown[]) => {
    const res = await doFetch(opts.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 8000),
    });
    if (!res.ok) throw new Error(`rpc ${method}: http ${res.status}`);
    const body = (await res.json()) as { result?: string; error?: { message: string } };
    if (body.error || typeof body.result !== "string") throw new Error(`rpc ${method}: ${body.error?.message ?? "no result"}`);
    return body.result;
  };
  const [code, nonce, balance] = await Promise.all([
    call(1, "eth_getCode", [address, "latest"]),
    call(2, "eth_getTransactionCount", [address, "latest"]),
    call(3, "eth_getBalance", [address, "latest"]),
  ]);
  // EIP-7702: a delegated EOA has exactly 23 bytes of code, 0xef0100 followed by the delegate address.
  const delegated = /^0xef0100[0-9a-fA-F]{40}$/.test(code);
  return {
    isContract: !delegated && code !== "0x" && code !== "0x0",
    ...(delegated ? { delegatedTo: `0x${code.slice(8)}` } : {}),
    txCount: Number.parseInt(nonce, 16),
    balanceWei: BigInt(balance).toString(),
  };
}

/**
 * Real public data: the OFAC sanctions list (local file) plus on-chain facts from a public RPC.
 * It never throws. A provider failure returns status "unavailable" and policy fails closed on it.
 */
export class OnchainChainClient implements ChainClient {
  constructor(
    private readonly sanctioned: Set<string>,
    private readonly rpc: RpcOptions,
  ) {}

  async addressRisk(address: string): Promise<AddressRisk> {
    if (!ADDRESS_RE.test(address)) return { address, flagged: false, labels: [], source: "onchain", status: "invalid" };
    const labels = this.sanctioned.has(address.toLowerCase()) ? ["ofac_sanctioned"] : [];
    try {
      const facts = await readAddressFacts(address, this.rpc);
      return { address, flagged: labels.length > 0, labels, source: "ofac+rpc", status: "ok", facts };
    } catch {
      // The sanctions list is local, so a hit is still reported even when the RPC is down.
      return { address, flagged: labels.length > 0, labels, source: "ofac", status: labels.length ? "ok" : "unavailable" };
    }
  }
}
