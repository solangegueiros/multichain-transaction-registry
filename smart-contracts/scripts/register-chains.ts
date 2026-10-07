import { network } from "hardhat";
import { projectConfig } from "../project-config.js";
import { assertPrivateKey } from "./lib/check-env.js";
import { CHAINS, SCHEMA_KEYS_BY_NETWORK } from "./lib/chains.js";
import { sendTx } from "./lib/send-tx.js";

const SCHEMA_KEYS = SCHEMA_KEYS_BY_NETWORK.flatMap(({ network, keys }) =>
  keys.map((k) => ({ network, ...k, required: false })),
);

const { ethers, networkName, networkConfig } = await network.create();
assertPrivateKey(networkConfig);

const [signer] = await ethers.getSigners();
console.log(`Network: ${networkName} | signer: ${signer.address}`);

// On the local simulated network the script deploys a fresh contract, so it can be tested.
// Elsewhere it uses the deployed contract at multiChainTxRegistryAddress (project.config.json, at the repository root).
let registry;

if (networkConfig.type === "edr-simulated") {
  registry = await ethers.deployContract("MultiChainTxRegistry");
  await registry.waitForDeployment();
} else if (projectConfig.multiChainTxRegistryAddress !== "") {
  registry = await ethers.getContractAt("MultiChainTxRegistry", projectConfig.multiChainTxRegistryAddress);
} else {
  throw new Error("Set multiChainTxRegistryAddress in project.config.json (repository root)");
}

console.log(`MultiChainTxRegistry: ${await registry.getAddress()}`);

for (const chain of CHAINS) {
  const chainId = await registry.computeChainId(chain.network);
  const registered = await registry.chains(chainId);

  if (registered.chainId !== ethers.ZeroHash) {
    console.log(`- ${chain.network}: already registered (${chainId})`);
    continue;
  }

  const tx = await sendTx(() => registry.registerChain(
    chain.network,
    chain.networkChainId,
    chain.name,
    chain.profileId,
    chain.genesisHash,
  ));

  console.log(`- ${chain.network}: registered (${chainId}) tx ${tx.hash}`);
}

console.log(`Total chains in the contract: ${await registry.getChainCount()}`);

// Schema keys: already registered keys are skipped, so the script can be run again
console.log("Schema keys:");

for (const item of SCHEMA_KEYS) {
  const key = ethers.encodeBytes32String(item.key);
  const schema = await registry.getSchema(item.network);

  if (schema.some((entry) => entry.key === key)) {
    console.log(`- ${item.network} / ${item.key}: already registered`);
    continue;
  }

  const tx = await sendTx(() => registry.registerSchemaKey(
    item.network,
    key,
    item.valueType,
    item.description,
    item.required,
  ));

  console.log(`- ${item.network} / ${item.key}: registered (${item.valueType}) tx ${tx.hash}`);
}
