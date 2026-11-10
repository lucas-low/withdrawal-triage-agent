// Refreshes data/ofac-eth.txt from the public list. Data only, nothing is executed.
const URL = "https://raw.githubusercontent.com/0xB10C/ofac-sanctioned-digital-currency-addresses/lists/sanctioned_addresses_ETH.txt";
const res = await fetch(URL);
if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
const addresses = (await res.text())
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => /^0x[0-9a-fA-F]{40}$/.test(l));
if (addresses.length < 50) throw new Error(`only ${addresses.length} valid addresses, refusing to overwrite`);
const header = [
  "# OFAC-sanctioned Ethereum addresses (one per line)",
  '# Source: https://github.com/0xB10C/ofac-sanctioned-digital-currency-addresses (branch "lists"), derived from the public US Treasury OFAC SDN list.',
  `# Fetched: ${new Date().toISOString().slice(0, 10)}. Refresh with: bun run data:ofac`,
];
await Bun.write("data/ofac-eth.txt", `${[...header, ...addresses].join("\n")}\n`);
console.log(`wrote ${addresses.length} addresses`);
