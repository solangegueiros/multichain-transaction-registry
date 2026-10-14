// Everything the pages need to know about the deployment. Nothing is typed twice:
// the values come from the files the other parts of the repository already keep.
import type { Address } from "viem";
import productionProject from "../../project.config.production.json";
import stagingProject from "../../project.config.staging.json";
import productionWorkflow from "../../workflow-registry/config/config.production.json";
import stagingWorkflow from "../../workflow-registry/config/config.staging.json";

const env: Record<string, string | undefined> = import.meta.env ?? {};

/// Environment of the deployment the app reads, chosen with `vite --mode staging` or
/// `--mode production` (see package.json). Each one has its own contracts on Ethereum
/// Sepolia, in project.config.<environment>.json.
export const ENVIRONMENT: "staging" | "production" = import.meta.env.MODE === "production" ? "production" : "staging";

const projectConfig = ENVIRONMENT === "production" ? productionProject : stagingProject;
const workflowConfig = ENVIRONMENT === "production" ? productionWorkflow : stagingWorkflow;

// For development against another deployment, such as a local Hardhat node, each value
// can be replaced in frontend/.env.local (see .env.example). Without it, the values of
// project.config.<environment>.json are used.

/// True when the app was pointed to another node: it may not be Ethereum Sepolia.
export const CUSTOM_RPC = Boolean(env.VITE_RPC_URL);

export const RPC_URL: string = env.VITE_RPC_URL || projectConfig.rpcUrl;

const address = (value: string): Address | null => (/^0x[0-9a-fA-F]{40}$/.test(value) ? (value as Address) : null);

/// Addresses of the deployed contracts. null: not deployed yet.
export const CONTRACTS = {
  txRegistry: address(env.VITE_TX_REGISTRY_ADDRESS || projectConfig.multiChainTxRegistryAddress),
  fundRegistry: address(env.VITE_FUND_REGISTRY_ADDRESS || projectConfig.fundRegistryAddress),
  orderRegistry: address(env.VITE_ORDER_REGISTRY_ADDRESS || projectConfig.orderRegistryAddress),
  receiver: address(env.VITE_RECEIVER_ADDRESS || projectConfig.multiChainTxReceiverAddress),
};

export const CONTRACT_NAMES: Record<keyof typeof CONTRACTS, string> = {
  txRegistry: "MultiChainTxRegistry",
  fundRegistry: "FundRegistry",
  orderRegistry: "OrderRegistry",
  receiver: "MultiChainTxReceiver",
};

/// Explorer of the chain of the contracts (Ethereum Sepolia).
export const CONTRACTS_EXPLORER = "https://sepolia.etherscan.io";

/// Forwarders of Chainlink CRE on Ethereum Sepolia, to tell which one the receiver uses.
export const FORWARDERS: Record<string, string> = {
  "0x15fc6ae953e024d975e77382eeec56a9101f9f88": "simulação (MockKeystoneForwarder)",
  "0xf8344cfd5c43616a4366c34e3eee75af79a74482": "produção (KeystoneForwarder)",
};

/// Observer API: the same client id the workflow uses. Requests go through the proxy
/// of vite.config.ts.
export const OBSERVER = {
  proxyPath: "/observer-api",
  clientId: workflowConfig.apiClientId,
};
