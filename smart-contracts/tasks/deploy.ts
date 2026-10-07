import type { HardhatRuntimeEnvironment } from "hardhat/types/hre";
import { verifyContract } from "@nomicfoundation/hardhat-verify/verify";
import { assertPrivateKey } from "../scripts/lib/check-env.js";
import {
  appendConfigBackup,
  projectConfig,
  saveProjectConfig,
  type AddressKey,
  type ProjectConfig,
} from "../project-config.js";
import { sendTx } from "../scripts/lib/send-tx.js";

// Action of the `deploy` task (declared in hardhat.config.ts).
//
// Deploys MultiChainTxRegistry, FundRegistry and OrderRegistry, in this order.
//
// MultiChainTxReceiver, the entry point of Chainlink CRE workflows, is deployed apart,
// by scripts/deploy-cre-receiver.ts.
//
//   no option   deploys only the contracts whose address is empty in project.config.json
//               (repository root) and reuses the others
//   --only X    deploys X again, plus the contracts that depend on it
//   --force     deploys the three again, ignoring the addresses already filled
//   --yes       confirms replacing contracts that are already deployed (real networks only)
//
// Each new address is saved to project.config.json as soon as the contract is deployed.
// Before a deployed contract is replaced, the current file is appended to
// project.backup.config.json, so the old addresses are not lost.
//
// On the local simulated network the addresses of project.config.json are ignored
// (they belong to the real network), every contract is deployed fresh and nothing is saved.

interface DeployArguments {
  only: string;
  force: boolean;
  yes: boolean;
}

interface ContractInfo {
  /// Contract name, as in the artifacts
  name: string;
  /// Value accepted by --only
  option: string;
  /// Field of project.config.json that holds the address
  key: AddressKey;
  /// Contracts received in the constructor, in order. A contract is bound for life
  /// to the ones it was deployed with, so replacing a dependency replaces it too.
  dependsOn: AddressKey[];
}

// In deployment order: a contract always comes after the ones it depends on
const CONTRACTS: ContractInfo[] = [
  {
    name: "MultiChainTxRegistry",
    option: "multichain-tx-registry",
    key: "multiChainTxRegistryAddress",
    dependsOn: [],
  },
  {
    name: "FundRegistry",
    option: "fund-registry",
    key: "fundRegistryAddress",
    dependsOn: ["multiChainTxRegistryAddress"],
  },
  {
    name: "OrderRegistry",
    option: "order-registry",
    key: "orderRegistryAddress",
    dependsOn: ["multiChainTxRegistryAddress", "fundRegistryAddress"],
  },
];

// Blocks to wait before verifying, so Etherscan has already indexed the contract
const VERIFY_CONFIRMATIONS = 5;

/// "order-registry", "OrderRegistry" and "orderregistry" all select the same contract.
function findContract(option: string): ContractInfo {
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const found = CONTRACTS.find((c) => normalize(c.option) === normalize(option) || normalize(c.name) === normalize(option));
  if (found === undefined) {
    throw new Error(`Unknown contract "${option}" in --only. Use one of: ${CONTRACTS.map((c) => c.option).join(", ")}`);
  }
  return found;
}

/// `start` plus every contract that depends on one of them, directly or not.
function withDependents(start: Set<AddressKey>): Set<AddressKey> {
  const result = new Set(start);
  // CONTRACTS is in deployment order, so one pass reaches the indirect dependents too
  for (const contract of CONTRACTS) {
    if (contract.dependsOn.some((dependency) => result.has(dependency))) result.add(contract.key);
  }
  return result;
}

export default async function deploy(args: DeployArguments, hre: HardhatRuntimeEnvironment): Promise<void> {
  if (args.only !== "" && args.force) {
    throw new Error("Use either --only or --force, not both");
  }

  await hre.tasks.getTask("build").run({});

  const { ethers, networkName, networkConfig } = await hre.network.create();
  assertPrivateKey(networkConfig);

  const isLocal = networkConfig.type === "edr-simulated";

  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Network: ${networkName} | deployer: ${deployer.address}`);
  console.log(`Balance: ${ethers.formatEther(balance)} ETH\n`);

  // On the local network nothing is deployed yet, whatever project.config.json says
  const before: ProjectConfig = isLocal
    ? { ...projectConfig, multiChainTxRegistryAddress: "", fundRegistryAddress: "", orderRegistryAddress: "" }
    : { ...projectConfig };
  const config: ProjectConfig = { ...before };

  // ---------------------------------------------------------------- Plan

  // Contracts the options ask to deploy again, with their dependents
  const requested = new Set<AddressKey>();
  if (args.force) {
    for (const contract of CONTRACTS) requested.add(contract.key);
  } else if (args.only !== "") {
    requested.add(findContract(args.only).key);
  }
  const requestedWithDependents = withDependents(requested);

  // Contracts that were never deployed, with their dependents
  const empty = new Set<AddressKey>(CONTRACTS.filter((c) => before[c.key] === "").map((c) => c.key));
  const toDeploy = withDependents(new Set([...requestedWithDependents, ...empty]));

  // A filled address below an empty one can never be valid: the contract there is bound
  // to another deployment. It is only replaced when the options ask for it.
  for (const contract of CONTRACTS) {
    if (toDeploy.has(contract.key) && before[contract.key] !== "" && !requestedWithDependents.has(contract.key)) {
      const emptyDependency = contract.dependsOn.find((dependency) => toDeploy.has(dependency));
      throw new Error(
        `${contract.key} is filled in project.config.json, but ${emptyDependency} is empty. ` +
          `The contract at ${contract.key} is bound to another ${emptyDependency}: ` +
          `clear ${contract.key} too, or use --only / --force to deploy it again.`,
      );
    }
  }

  // Deployed contracts that will be left behind
  const replaced = CONTRACTS.filter((c) => toDeploy.has(c.key) && before[c.key] !== "");

  console.log("Plan:");
  for (const contract of CONTRACTS) {
    const current = before[contract.key];
    if (!toDeploy.has(contract.key)) {
      console.log(`- ${contract.name}: reuse ${current}`);
    } else if (current === "") {
      console.log(`- ${contract.name}: deploy`);
    } else {
      const why = requested.has(contract.key) ? "requested" : "depends on a contract that is deployed again";
      console.log(`- ${contract.name}: DEPLOY AGAIN (${why}), replacing ${current}`);
    }
  }
  console.log("");

  if (replaced.length !== 0) {
    console.log(
      "A contract that is deployed again starts empty, at a new address. The contract it replaces " +
        "stays on-chain with its data, but is no longer referenced by project.config.json.",
    );

    if (!args.yes) {
      console.log(`\nNothing was deployed. To go ahead and replace ${replaced.map((c) => c.name).join(", ")}, run again with --yes.`);
      process.exitCode = 1;
      return;
    }

    appendConfigBackup({
      savedAt: new Date().toISOString(),
      network: networkName,
      reason: args.force ? "--force" : `--only ${findContract(args.only).option}`,
      replaced: replaced.map((c) => c.name),
      config: before,
    });
    console.log("The current addresses were saved to project.backup.config.json.\n");
  }

  // ---------------------------------------------------------------- Deploy

  for (const contract of CONTRACTS) {
    if (!toDeploy.has(contract.key)) {
      if ((await ethers.provider.getCode(config[contract.key])) === "0x") {
        throw new Error(
          `${contract.key} in project.config.json is ${config[contract.key]}, but there is no contract at this address on ${networkName}`,
        );
      }
      console.log(`${contract.name}: ${config[contract.key]} (reused)`);
      continue;
    }

    const constructorArgs = contract.dependsOn.map((dependency) => config[dependency]);

    const deployed = await ethers.deployContract(contract.name, constructorArgs);
    const deployTx = deployed.deploymentTransaction();
    console.log(`${contract.name}: deploying... tx ${deployTx?.hash}`);
    await deployed.waitForDeployment();

    const address = await deployed.getAddress();
    console.log(`${contract.name}: ${address} (deployed)`);
    config[contract.key] = address;

    if (isLocal) continue;

    // Saved right away: if a later step fails, this contract is not deployed twice
    saveProjectConfig(config);
    console.log(`  saved as ${contract.key} in project.config.json`);

    console.log(`  waiting for ${VERIFY_CONFIRMATIONS} confirmations before verifying on Etherscan...`);
    await deployTx?.wait(VERIFY_CONFIRMATIONS);

    try {
      await verifyContract({ address, constructorArgs, provider: "etherscan" }, hre);
    } catch (error) {
      // The deploy is already done: a verification failure must not fail the task
      console.error(`  verification failed: ${error instanceof Error ? error.message : error}`);
      console.error(`  retry with: npx hardhat verify etherscan --network ${networkName} ${address} ${constructorArgs.join(" ")}`);
    }
  }

  // ---------------------------------------------------------------- Links

  const txRegistry = await ethers.getContractAt("MultiChainTxRegistry", config.multiChainTxRegistryAddress);
  const fundRegistry = await ethers.getContractAt("FundRegistry", config.fundRegistryAddress);
  const orderRegistry = await ethers.getContractAt("OrderRegistry", config.orderRegistryAddress);

  // Reused contracts must point to each other, or the addresses are from different deployments
  const links: [string, string, string][] = [
    ["FundRegistry.txRegistry", await fundRegistry.txRegistry(), config.multiChainTxRegistryAddress],
    ["OrderRegistry.txRegistry", await orderRegistry.txRegistry(), config.multiChainTxRegistryAddress],
    ["OrderRegistry.fundRegistry", await orderRegistry.fundRegistry(), config.fundRegistryAddress],
  ];
  for (const [what, actual, expected] of links) {
    if (actual.toLowerCase() !== expected.toLowerCase()) {
      throw new Error(
        `${what} is ${actual}, expected ${expected}. ` +
          "The addresses in project.config.json do not belong to the same deployment: " +
          "use --only on the contract that must be deployed again.",
      );
    }
  }

  // ---------------------------------------------------------------- Relayers

  // FundRegistry and OrderRegistry register transactions in MultiChainTxRegistry, so both
  // need RELAYER_ROLE there. Only an admin of MultiChainTxRegistry can grant it.
  console.log("\nRelayers in MultiChainTxRegistry:");

  const ADMIN_ROLE = await txRegistry.DEFAULT_ADMIN_ROLE();
  const RELAYER_ROLE = await txRegistry.RELAYER_ROLE();
  const deployerIsAdmin = await txRegistry.hasRole(ADMIN_ROLE, deployer.address);

  const pendingRelayers: string[] = [];
  const staleRelayers: string[] = [];

  for (const contract of CONTRACTS.filter((c) => c.key !== "multiChainTxRegistryAddress")) {
    const address = config[contract.key];

    if (await txRegistry.hasRole(RELAYER_ROLE, address)) {
      console.log(`- ${contract.name} ${address}: already a relayer`);
    } else if (deployerIsAdmin) {
      const tx = await sendTx(() => txRegistry.grantRole(RELAYER_ROLE, address));
      console.log(`- ${contract.name} ${address}: granted RELAYER_ROLE, tx ${tx.hash}`);
    } else {
      pendingRelayers.push(address);
      console.log(`- ${contract.name} ${address}: NOT a relayer yet`);
    }

    // The contract that was replaced keeps its role in a MultiChainTxRegistry that stays
    const old = before[contract.key];
    const txRegistryKept = !toDeploy.has("multiChainTxRegistryAddress");
    if (old !== "" && old !== address && txRegistryKept && (await txRegistry.hasRole(RELAYER_ROLE, old))) {
      staleRelayers.push(old);
      console.log(`- ${contract.name} ${old} (replaced): STILL a relayer`);
    }
  }

  // ---------------------------------------------------------------- Summary

  // AccessControl does not list the holders of a role, so only the deployer is checked
  const isAdmin = async (contract: { hasRole(role: string, account: string): Promise<boolean> }) =>
    (await contract.hasRole(ADMIN_ROLE, deployer.address)) ? "the deployer is an admin" : "the deployer is NOT an admin";

  console.log("\nDone.");
  console.log(`  MultiChainTxRegistry: ${config.multiChainTxRegistryAddress} | ${await isAdmin(txRegistry)}`);
  console.log(`  FundRegistry:         ${config.fundRegistryAddress} | ${await isAdmin(fundRegistry)}`);
  console.log(`  OrderRegistry:        ${config.orderRegistryAddress} | ${await isAdmin(orderRegistry)}`);

  if (pendingRelayers.length !== 0) {
    console.log("\nThe deployer is not an admin of MultiChainTxRegistry. One of its admins must call:");
    for (const address of pendingRelayers) console.log(`  grantRole(${RELAYER_ROLE}, ${address})`);
  }

  if (staleRelayers.length !== 0) {
    console.log("\nThe replaced contracts still have RELAYER_ROLE in MultiChainTxRegistry and can still");
    console.log("register transactions there. To revoke them, an admin of MultiChainTxRegistry can call:");
    for (const address of staleRelayers) console.log(`  revokeRole(${RELAYER_ROLE}, ${address})`);
  }

  // MultiChainTxReceiver is deployed by another script, but it is bound to the
  // MultiChainTxRegistry it was deployed with
  if (!isLocal && projectConfig.multiChainTxReceiverAddress !== "" && toDeploy.has("multiChainTxRegistryAddress")) {
    console.log(`\nMultiChainTxReceiver ${projectConfig.multiChainTxReceiverAddress} is bound to the MultiChainTxRegistry that was`);
    console.log("replaced. Clear multiChainTxReceiverAddress in project.config.json and deploy it again:");
    console.log("  npx hardhat run scripts/deploy-cre-receiver.ts --network " + networkName);
  }

  console.log("\nNext steps:");
  if (toDeploy.has("multiChainTxRegistryAddress")) {
    console.log("  - register the chains and schema keys: scripts/register-chains.ts");
  }
  console.log("  - an admin of each new FundRegistry / OrderRegistry must grant OPERATOR_ROLE to the accounts that will load data");
  if (replaced.length !== 0) {
    console.log("  - load again, into the new contracts, the data that was in the replaced ones");
  }
}
