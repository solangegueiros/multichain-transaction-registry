import hardhatToolboxMochaEthers from "@nomicfoundation/hardhat-toolbox-mocha-ethers";
import { configVariable, defineConfig, task } from "hardhat/config";
import type { HttpNetworkUserConfig } from "hardhat/types/config";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadProjectConfig, repoRootUrl, type Environment } from "./project-config.js";

// Loads the secrets from the .env at the repository root (see .env.example)
const envPath = fileURLToPath(new URL(".env", repoRootUrl));
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

// npx hardhat deploy [--network <name>] [--only <contract> | --force] [--yes]
const deployTask = task("deploy", "Deploy MultiChainTxRegistry, FundRegistry and OrderRegistry")
  .addOption({
    name: "only",
    description:
      "Deploy this contract again, plus the ones that depend on it: multichain-tx-registry, fund-registry or order-registry",
    defaultValue: "",
  })
  .addFlag({
    name: "force",
    description: "Deploy the three contracts again, ignoring the addresses in project.config.<network>.json",
  })
  .addFlag({
    name: "yes",
    description: "Confirm replacing contracts that are already deployed (required on real networks)",
  })
  .setAction(() => import("./tasks/deploy.js"))
  .build();

// One network per environment, both on Ethereum Sepolia. Each one reads and writes the
// addresses of its own project.config.<environment>.json: --network staging or --network production
const sepoliaNetwork = (environment: Environment): HttpNetworkUserConfig => ({
  type: "http",
  chainType: "l1",
  url: loadProjectConfig(environment).rpcUrl,
  accounts: [configVariable("ETH_PRIVATE_KEY")],
});

export default defineConfig({
  plugins: [hardhatToolboxMochaEthers],
  tasks: [deployTask],
  solidity: {
    version: "0.8.36",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    staging: sepoliaNetwork("staging"),
    production: sepoliaNetwork("production"),
  },
  verify: {
    etherscan: {
      apiKey: configVariable("ETHERSCAN_API_KEY"),
    },
  },
});
