import hre from "hardhat";
import { verifyContract } from "@nomicfoundation/hardhat-verify/verify";
import { assertPrivateKey } from "./lib/check-env.js";
import { projectConfig, saveProjectConfig } from "../project-config.js";
import { sendTx } from "./lib/send-tx.js";

// Deploys MultiChainTxReceiver, the entry point of Chainlink CRE workflows, and keeps
// its configuration in line with project.config.json (repository root): the forwarder,
// the OrderRegistry and the FundRegistry it writes to, and the roles it needs in them.
//
// Run it after the `deploy` task: the receiver needs the MultiChainTxRegistry, and it
// links transactions to orders and funds through the OrderRegistry and the FundRegistry.
//
//   multiChainTxReceiverAddress empty   deploys a new receiver and saves its address
//   multiChainTxReceiverAddress filled  reuses that receiver; nothing is deployed
//
// The forwarder is the only account allowed to deliver reports to the receiver:
//
//   creForwarderAddress empty   a new receiver is deployed with the MockKeystoneForwarder,
//                               for `cre workflow simulate --broadcast`. The forwarder of
//                               an existing receiver is left as it is.
//   creForwarderAddress filled  a new receiver is deployed with it, and an existing
//                               receiver is updated to it (setForwarderAddress).
//
// The receiver is pointed to the OrderRegistry and the FundRegistry of project.config.json,
// and receives OPERATOR_ROLE in both and RELAYER_ROLE in MultiChainTxRegistry. Each of these
// is done only when the account that runs the script is an admin of the contract involved;
// otherwise the script lists what an admin still has to do.
//
// The script can be run again: it only sends the transactions that are still missing.

// Chainlink CRE on Ethereum Sepolia (chain name: ethereum-testnet-sepolia).
// From the CRE documentation; check the Forwarder Directory page before a production deploy.
const CRE_CHAIN_NAME = "ethereum-testnet-sepolia";
// Used by `cre workflow simulate --broadcast`. Sends no workflow identity. Simulation only.
const MOCK_FORWARDER = "0x15fC6ae953E024d975e77382eEeC56A9101f9F88";
// KeystoneForwarder: used by deployed workflows, after verifying the signatures of the DON.
const PRODUCTION_FORWARDER = "0xF8344CFd5c43616a4366C34E3EEE75af79a74482";

// Blocks to wait before verifying, so Etherscan has already indexed the contract
const VERIFY_CONFIRMATIONS = 5;

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function describeForwarder(address: string): string {
  if (same(address, MOCK_FORWARDER)) return "MockKeystoneForwarder (simulation only)";
  if (same(address, PRODUCTION_FORWARDER)) return "KeystoneForwarder (deployed workflows)";
  return "custom forwarder";
}

const { ethers, networkName, networkConfig } = await hre.network.create();
assertPrivateKey(networkConfig);

const isLocal = networkConfig.type === "edr-simulated";

const [deployer] = await ethers.getSigners();
console.log(`Network: ${networkName} | deployer: ${deployer.address}`);
console.log(`CRE chain name: ${CRE_CHAIN_NAME}\n`);

const forwarderIsConfigured = projectConfig.creForwarderAddress !== "";
const wantedForwarder = forwarderIsConfigured ? projectConfig.creForwarderAddress : MOCK_FORWARDER;

if (!ethers.isAddress(wantedForwarder)) {
  throw new Error(`creForwarderAddress in project.config.json is not an address: ${wantedForwarder}`);
}

// ---------------------------------------------------------------- MultiChainTxRegistry

// On the local simulated network the script deploys a fresh registry, so it can be tested.
// Elsewhere it uses the one deployed by the `deploy` task.
let txRegistry;

// Addresses of the registries the receiver must point to ("" = not deployed yet)
let wantedFundRegistry = projectConfig.fundRegistryAddress;
let wantedOrderRegistry = projectConfig.orderRegistryAddress;

if (isLocal) {
  txRegistry = await ethers.deployContract("MultiChainTxRegistry");
  await txRegistry.waitForDeployment();

  const funds = await ethers.deployContract("FundRegistry", [await txRegistry.getAddress()]);
  await funds.waitForDeployment();
  const orders = await ethers.deployContract("OrderRegistry", [await txRegistry.getAddress(), await funds.getAddress()]);
  await orders.waitForDeployment();

  wantedFundRegistry = await funds.getAddress();
  wantedOrderRegistry = await orders.getAddress();
} else if (projectConfig.multiChainTxRegistryAddress !== "") {
  txRegistry = await ethers.getContractAt("MultiChainTxRegistry", projectConfig.multiChainTxRegistryAddress);
} else {
  throw new Error("multiChainTxRegistryAddress is empty in project.config.json (repository root). Deploy the contracts first: npx hardhat deploy");
}

const txRegistryAddress = await txRegistry.getAddress();
console.log(`MultiChainTxRegistry: ${txRegistryAddress}`);

// ---------------------------------------------------------------- MultiChainTxReceiver

const existing = isLocal ? "" : projectConfig.multiChainTxReceiverAddress;
let receiver;

if (existing !== "") {
  if ((await ethers.provider.getCode(existing)) === "0x") {
    throw new Error(`multiChainTxReceiverAddress in project.config.json is ${existing}, but there is no contract at this address on ${networkName}`);
  }

  receiver = await ethers.getContractAt("MultiChainTxReceiver", existing);

  // A receiver is bound for life to the registry it was deployed with
  const bound = await receiver.txRegistry();
  if (!same(bound, txRegistryAddress)) {
    throw new Error(
      `MultiChainTxReceiver ${existing} writes to MultiChainTxRegistry ${bound}, not to ${txRegistryAddress}. ` +
        "Clear multiChainTxReceiverAddress in project.config.json and run again to deploy a new receiver.",
    );
  }

  console.log(`MultiChainTxReceiver: ${existing} (already deployed, reused)`);
} else {
  const constructorArgs = [wantedForwarder, txRegistryAddress];

  receiver = await ethers.deployContract("MultiChainTxReceiver", constructorArgs);
  const deployTx = receiver.deploymentTransaction();
  console.log(`MultiChainTxReceiver: deploying with forwarder ${wantedForwarder}... tx ${deployTx?.hash}`);
  await receiver.waitForDeployment();

  const address = await receiver.getAddress();
  console.log(`MultiChainTxReceiver: ${address} (deployed)`);

  if (!isLocal) {
    // Saved right away: if a later step fails, the receiver is not deployed twice
    saveProjectConfig({ ...projectConfig, multiChainTxReceiverAddress: address });
    console.log("  saved as multiChainTxReceiverAddress in project.config.json");

    console.log(`  waiting for ${VERIFY_CONFIRMATIONS} confirmations before verifying on Etherscan...`);
    await deployTx?.wait(VERIFY_CONFIRMATIONS);

    try {
      await verifyContract({ address, constructorArgs, provider: "etherscan" }, hre);
    } catch (error) {
      // The deploy is already done: a verification failure must not fail the script
      console.error(`  verification failed: ${error instanceof Error ? error.message : error}`);
      console.error(`  retry with: npx hardhat verify etherscan --network ${networkName} ${address} ${constructorArgs.join(" ")}`);
    }
  }
}

const receiverAddress = await receiver.getAddress();
const receiverAdminRole = await receiver.DEFAULT_ADMIN_ROLE();
const deployerIsReceiverAdmin = await receiver.hasRole(receiverAdminRole, deployer.address);

const pending: string[] = [];

// ---------------------------------------------------------------- Forwarder

let currentForwarder = await receiver.getForwarderAddress();

if (same(currentForwarder, wantedForwarder)) {
  // nothing to do
} else if (!forwarderIsConfigured) {
  // An empty creForwarderAddress never changes a receiver that is already deployed:
  // it must not put a production receiver back on the simulation forwarder.
  console.log("\ncreForwarderAddress is empty in project.config.json: the forwarder of the receiver was left as it is.");
} else if (deployerIsReceiverAdmin) {
  const tx = await sendTx(() => receiver.setForwarderAddress(wantedForwarder));
  console.log(`\nForwarder changed from ${currentForwarder} to ${wantedForwarder}, tx ${tx.hash}`);
  currentForwarder = wantedForwarder;
} else {
  pending.push(`an admin of MultiChainTxReceiver must call setForwarderAddress(${wantedForwarder})`);
}

// ---------------------------------------------------------------- OrderRegistry / FundRegistry

// The receiver links transactions to orders and to funds through these two registries.
// It must point to each of them, and have OPERATOR_ROLE there.
console.log("");

const targets = [
  {
    name: "OrderRegistry",
    configKey: "orderRegistryAddress",
    wanted: wantedOrderRegistry,
    current: await receiver.orderRegistry(),
    setter: "setOrderRegistry",
    set: (address: string) => receiver.setOrderRegistry(address),
  },
  {
    name: "FundRegistry",
    configKey: "fundRegistryAddress",
    wanted: wantedFundRegistry,
    current: await receiver.fundRegistry(),
    setter: "setFundRegistry",
    set: (address: string) => receiver.setFundRegistry(address),
  },
];

const linked: string[] = [];

for (const target of targets) {
  let current = target.current;

  if (target.wanted === "") {
    // Nothing to point to yet. A registry already set in the receiver is left as it is.
    if (current === ethers.ZeroAddress) {
      console.log(`${target.name}: not set. ${target.configKey} is empty in project.config.json: deploy the contracts and run this script again.`);
      linked.push(`${target.name}: not set`);
      continue;
    }
  } else if (same(current, target.wanted)) {
    // nothing to do
  } else if (deployerIsReceiverAdmin) {
    const tx = await sendTx(() => target.set(target.wanted));
    console.log(`${target.name}: receiver pointed to ${target.wanted}, tx ${tx.hash}`);
    current = target.wanted;
  } else {
    pending.push(`an admin of MultiChainTxReceiver must call ${target.setter}(${target.wanted})`);
  }

  if (current === ethers.ZeroAddress) {
    linked.push(`${target.name}: not set`);
    continue;
  }

  // Both registries have the same role functions (RegistryBase)
  const registry = await ethers.getContractAt("FundRegistry", current);
  const OPERATOR_ROLE = await registry.OPERATOR_ROLE();

  if (await registry.hasRole(OPERATOR_ROLE, receiverAddress)) {
    console.log(`${target.name} ${current}: OPERATOR_ROLE already granted`);
    linked.push(`${target.name}: ${current}`);
  } else if (await registry.hasRole(await registry.DEFAULT_ADMIN_ROLE(), deployer.address)) {
    const tx = await sendTx(() => registry.grantRole(OPERATOR_ROLE, receiverAddress));
    console.log(`${target.name} ${current}: OPERATOR_ROLE granted, tx ${tx.hash}`);
    linked.push(`${target.name}: ${current}`);
  } else {
    console.log(`${target.name} ${current}: OPERATOR_ROLE NOT granted`);
    pending.push(`an admin of ${target.name} must call grantRole(${OPERATOR_ROLE}, ${receiverAddress})`);
    linked.push(`${target.name}: ${current} (without OPERATOR_ROLE)`);
  }
}

// ---------------------------------------------------------------- Relayer role

// The receiver registers transactions in MultiChainTxRegistry, so it needs RELAYER_ROLE there
const RELAYER_ROLE = await txRegistry.RELAYER_ROLE();

if (await txRegistry.hasRole(RELAYER_ROLE, receiverAddress)) {
  console.log("\nRELAYER_ROLE in MultiChainTxRegistry: already granted");
} else if (await txRegistry.hasRole(await txRegistry.DEFAULT_ADMIN_ROLE(), deployer.address)) {
  const tx = await sendTx(() => txRegistry.grantRole(RELAYER_ROLE, receiverAddress));
  console.log(`\nRELAYER_ROLE in MultiChainTxRegistry: granted, tx ${tx.hash}`);
} else {
  console.log("\nRELAYER_ROLE in MultiChainTxRegistry: NOT granted");
  pending.push(`an admin of MultiChainTxRegistry must call grantRole(${RELAYER_ROLE}, ${receiverAddress})`);
}

// ---------------------------------------------------------------- Summary

const expectedWorkflowId = await receiver.getExpectedWorkflowId();
const expectedAuthor = await receiver.getExpectedAuthor();
const restricted = expectedWorkflowId !== ethers.ZeroHash || expectedAuthor !== ethers.ZeroAddress;

console.log("\nDone.");
console.log(`  MultiChainTxReceiver: ${receiverAddress} | ${deployerIsReceiverAdmin ? "the deployer is an admin" : "the deployer is NOT an admin"}`);
console.log(`  Forwarder:            ${currentForwarder} | ${describeForwarder(currentForwarder)}`);
console.log(`  Workflow restriction: ${restricted ? `workflow id ${expectedWorkflowId}, author ${expectedAuthor}` : "none"}`);
for (const line of linked) console.log(`  ${line}`);

if (pending.length !== 0) {
  console.log("\nStill to be done:");
  for (const item of pending) console.log(`  - ${item}`);
}

if (same(currentForwarder, MOCK_FORWARDER)) {
  console.log("\nThis receiver trusts the MockKeystoneForwarder: use it only to simulate workflows");
  console.log("(cre workflow simulate --broadcast). Keep the workflow restriction off while simulating:");
  console.log("the mock forwarder sends no workflow identity. Before deploying a workflow, set");
  console.log(`creForwarderAddress to ${PRODUCTION_FORWARDER} in project.config.json and run this script again.`);
} else if (!restricted) {
  console.log("\nNo workflow restriction is set: ANY workflow of ANY owner can deliver reports to this");
  console.log("receiver. An admin should call setExpectedWorkflowId or setExpectedAuthor.");
}
