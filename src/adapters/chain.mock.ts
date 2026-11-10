import type { AddressRisk, ChainClient } from "../ports";

/** Stand-in for a chain analytics provider (Chainalysis, TRM, etc). Deterministic and offline. */
export class MockChainClient implements ChainClient {
  constructor(
    private readonly flagged: Record<string, string[]> = {
      "0xbad1": ["mixer"],
      "0xbad2": ["sanctioned"],
    },
  ) {}

  async addressRisk(address: string): Promise<AddressRisk> {
    const labels = this.flagged[address.toLowerCase()] ?? [];
    return { address, flagged: labels.length > 0, labels, source: "mock-chain-intel" };
  }
}
