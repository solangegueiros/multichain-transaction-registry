import hre from "hardhat";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Runs every setup step, in order, on the network given with --network:
//
//   1. build                    compiles the contracts
//   2. deploy                   MultiChainTxRegistry, FundRegistry and OrderRegistry
//   3. register-chains.ts       the chains and their schema keys
//   4. register-stablecoins.ts  the stablecoins of the funds
//   5. deploy-cre-receiver.ts   MultiChainTxReceiver, the entry point of Chainlink CRE
//
// Each step is the same command the README gives for it, run as its own process, so
// each one reads the addresses the previous one saved in project.config.json.
//
// Every step skips what is already done. If the script stops halfway, run it again:
// it continues from where it stopped. It never replaces a contract that is already
// deployed; for that, use the deploy task with --only or --force.
//
// Without --network the steps run on the local simulated network, where each step
// starts from an empty chain and nothing is saved: useful only to check that they run.

const networkName = hre.globalOptions.network;
const networkArgs = networkName ? ["--network", networkName] : [];

const STEPS: { title: string; args: string[] }[] = [
  { title: "Compile the contracts", args: ["build"] },
  { title: "Deploy the registries", args: ["deploy", ...networkArgs] },
  { title: "Register the chains and schema keys", args: ["run", "scripts/register-chains.ts", ...networkArgs] },
  { title: "Register the stablecoins", args: ["run", "scripts/register-stablecoins.ts", ...networkArgs] },
  { title: "Deploy the Chainlink CRE receiver", args: ["run", "scripts/deploy-cre-receiver.ts", ...networkArgs] },
];

const projectDir = fileURLToPath(new URL("..", import.meta.url));

console.log(`Network: ${networkName ?? "default (local simulated network)"}`);

for (const [i, step] of STEPS.entries()) {
  const command = `npx hardhat ${step.args.join(" ")}`;
  console.log(`\n=== Step ${i + 1} of ${STEPS.length}: ${step.title} ===`);
  console.log(`> ${command}\n`);

  // shell: npx is a .cmd file on Windows. The arguments are fixed, except the network
  // name, which Hardhat has already accepted as the name of a configured network.
  const result = spawnSync(command, { cwd: projectDir, stdio: "inherit", shell: true });

  if (result.status !== 0) {
    console.error(`\nError: step ${i + 1} (${step.title}) failed. Fix the cause and run this script again:`);
    console.error("the steps already done are skipped.");
    process.exit(1);
  }
}

console.log(`\nAll ${STEPS.length} steps done.`);
