import { createInterface } from "node:readline/promises";
import { triage } from "./agent";
import { decide } from "./gate";

const id = process.argv[2];
if (!id) {
  console.error("usage: bun run triage <withdrawalId>");
  process.exit(1);
}

const proposal = await triage(id);
if (!proposal) {
  console.log("agent did not produce a proposal");
  process.exit(1);
}
console.log(`\nProposal: ${proposal.action.toUpperCase()}\nReason: ${proposal.reason}\n`);

const rl = createInterface({ input: process.stdin, output: process.stdout });
const answer = (await rl.question("Approve? [y/N] ")).trim().toLowerCase();
rl.close();
const result = decide(id, answer === "y", process.env.USER ?? "reviewer");
console.log(result.applied ? `Applied: ${result.applied}` : "Rejected, nothing applied.");
