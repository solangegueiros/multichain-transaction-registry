import { network } from "hardhat";
import { projectConfig } from "../project-config.js";
import { assertPrivateKey } from "./lib/check-env.js";
import { CHAINS } from "./lib/chains.js";

// Extra arg keys accepted per network: the network-specific fields of
// connectorResults.{source|destination} that have no fixed field in TxInput.
// All optional: a missing key must not block the registration of a transaction
// (e.g. the lock acknowledgment, for which only the hash is known).
//
// Not registered on purpose, because TxInput already carries them:
//   transactionType / operationType -> txType        issuer -> assetIssuer
//   ledgerIndex / ledgerSequence    -> blockNumber   currency / assetCode -> assetCode
//   rayls.tokenContract             -> assetIssuer   rayls.currency       -> assetCode
const BLOCK_HASH = {
  key: "blockHash",
  valueType: "bytes32",
  description: "Hash of the block that includes the transaction",
};
const LOG_INDEX = {
  key: "logIndex",
  valueType: "uint256",
  description: "Index of the transfer log in the block",
};
const LEDGER_HASH = {
  key: "ledgerHash",
  valueType: "bytes32",
  description: "Hash of the ledger that includes the transaction",
};

const KEYS_BY_NETWORK = [
  // EVM networks
  { network: "eip155:51", keys: [BLOCK_HASH, LOG_INDEX] },
  { network: "eip155:50", keys: [BLOCK_HASH, LOG_INDEX] },
  { network: "eip155:80002", keys: [BLOCK_HASH, LOG_INDEX] },
  {
    network: "eip155:7295799",
    keys: [
      BLOCK_HASH,
      LOG_INDEX,
      {
        key: "verificationScope",
        valueType: "string",
        description: "How the transaction was verified (rayls.verificationScope)",
      },
    ],
  },
  // XRPL: the account sequence fits in 32 bits
  {
    network: "xrpl:testnet",
    keys: [
      LEDGER_HASH,
      { key: "sequence", valueType: "uint32", description: "Account sequence of the transaction (xrpl.sequence)" },
    ],
  },
  // Stellar: the account sequence needs 64 bits
  {
    network: "stellar:testnet",
    keys: [
      LEDGER_HASH,
      { key: "sequence", valueType: "uint64", description: "Account sequence of the transaction (stellar.sequence)" },
    ],
  },
];

const SCHEMA_KEYS = KEYS_BY_NETWORK.flatMap(({ network, keys }) =>
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

  const tx = await registry.registerChain(
    chain.network,
    chain.networkChainId,
    chain.name,
    chain.profileId,
    chain.genesisHash,
  );
  await tx.wait();

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

  const tx = await registry.registerSchemaKey(
    item.network,
    key,
    item.valueType,
    item.description,
    item.required,
  );
  await tx.wait();

  console.log(`- ${item.network} / ${item.key}: registered (${item.valueType}) tx ${tx.hash}`);
}
