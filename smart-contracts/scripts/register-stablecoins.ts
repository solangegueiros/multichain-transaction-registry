import { network } from "hardhat";
import { projectConfig } from "../project-config.js";
import { assertPrivateKey } from "./lib/check-env.js";
import { CHAINS } from "./lib/chains.js";

// Registers in FundRegistry the stablecoins used by the funds.
//
// A stablecoin is identified by (network, token address): it must be registered before
// the funds that use it, and its network must already be registered in MultiChainTxRegistry
// (scripts/register-chains.ts). Stablecoins already registered are skipped, so the script
// can be run again.

// Stablecoins found in query-json/fund*.json (stableSymbol / stableAddress / stableDecimals)
const STABLECOINS = [
  {
    // fund.json and fund2.json
    network: "eip155:51",
    tokenAddress: "0x243e98638D619eB6f10eaBbaCfC071f318D5e9d0",
    symbol: "BRL-CVM",
    decimals: 18,
  },
  {
    // fund3.json
    network: "eip155:80002",
    tokenAddress: "0x25fC15B20F67049249FF70BB8A846e66BE07693C",
    symbol: "BRL1",
    decimals: 18,
  },
  {
    // fund4.json
    network: "eip155:50",
    tokenAddress: "0x490590Eab907C4aF8aF845049FC7ac2F97e535F6",
    symbol: "BRL-CVM-DEV",
    decimals: 18,
  },
];

const { ethers, networkName, networkConfig } = await network.create();
assertPrivateKey(networkConfig);

const isLocal = networkConfig.type === "edr-simulated";

const [signer] = await ethers.getSigners();
console.log(`Network: ${networkName} | signer: ${signer.address}`);

// On the local simulated network the script deploys fresh contracts and registers the
// chains, so it can be tested. Elsewhere it uses the deployed FundRegistry at
// fundRegistryAddress (project.config.json, at the repository root).
let fundRegistry;

if (isLocal) {
  const txRegistry = await ethers.deployContract("MultiChainTxRegistry");
  await txRegistry.waitForDeployment();
  for (const chain of CHAINS) {
    await txRegistry.registerChain(chain.network, chain.networkChainId, chain.name, chain.profileId, chain.genesisHash);
  }

  fundRegistry = await ethers.deployContract("FundRegistry", [await txRegistry.getAddress()]);
  await fundRegistry.waitForDeployment();
} else if (projectConfig.fundRegistryAddress !== "") {
  fundRegistry = await ethers.getContractAt("FundRegistry", projectConfig.fundRegistryAddress);
} else {
  throw new Error("fundRegistryAddress is empty in project.config.json (repository root). Deploy the contracts first: npx hardhat deploy");
}

const txRegistry = await ethers.getContractAt("MultiChainTxRegistry", await fundRegistry.txRegistry());

console.log(`FundRegistry: ${await fundRegistry.getAddress()}`);
console.log(`MultiChainTxRegistry: ${await txRegistry.getAddress()}`);

// Every network is checked before any transaction is sent, so the script does not stop halfway
const missingNetworks: string[] = [];
for (const coin of STABLECOINS) {
  const chainId = await txRegistry.computeChainId(coin.network);
  if ((await txRegistry.chains(chainId)).chainId === ethers.ZeroHash && !missingNetworks.includes(coin.network)) {
    missingNetworks.push(coin.network);
  }
}
if (missingNetworks.length !== 0) {
  throw new Error(
    `Not registered in MultiChainTxRegistry: ${missingNetworks.join(", ")}. ` +
      "Register the chains first: npx hardhat run scripts/register-chains.ts",
  );
}

// Only accounts with OPERATOR_ROLE can register stablecoins. An admin of FundRegistry is
// allowed to grant the role to itself, so the script does it; any other account must be
// authorized first.
const OPERATOR_ROLE = await fundRegistry.OPERATOR_ROLE();

if (!(await fundRegistry.hasRole(OPERATOR_ROLE, signer.address))) {
  if (!(await fundRegistry.hasRole(await fundRegistry.DEFAULT_ADMIN_ROLE(), signer.address))) {
    throw new Error(
      `${signer.address} is not an operator of FundRegistry. ` +
        `One of its admins must call grantRole(${OPERATOR_ROLE}, ${signer.address}) first.`,
    );
  }

  const tx = await fundRegistry.grantRole(OPERATOR_ROLE, signer.address);
  await tx.wait();
  console.log(`The signer is an admin of FundRegistry and was not an operator: granted OPERATOR_ROLE, tx ${tx.hash}`);
}

const registered = new Set((await fundRegistry.listStableCoins()).map((coin) => coin.stableKey));

console.log("Stablecoins:");

for (const coin of STABLECOINS) {
  const chainId = await txRegistry.computeChainId(coin.network);
  const stableKey = await fundRegistry.stableCoinKeyOf(chainId, coin.tokenAddress);
  const label = `${coin.symbol} on ${coin.network} (${coin.tokenAddress})`;

  if (registered.has(stableKey)) {
    const stored = await fundRegistry.getStableCoin(chainId, coin.tokenAddress);
    // A registered stablecoin cannot be changed: warn if it differs from this list
    const differs = stored.symbol !== coin.symbol || Number(stored.decimals) !== coin.decimals;
    console.log(
      `- ${label}: already registered` +
        (differs ? ` as ${stored.symbol} with ${stored.decimals} decimals - DIFFERENT from this script, and it cannot be changed` : ""),
    );
    continue;
  }

  const tx = await fundRegistry.registerStableCoin(chainId, coin.tokenAddress, coin.symbol, coin.decimals);
  await tx.wait();

  console.log(`- ${label}: registered, ${coin.decimals} decimals, tx ${tx.hash}`);
}

console.log(`Total stablecoins in the contract: ${await fundRegistry.getStableCoinCount()}`);
