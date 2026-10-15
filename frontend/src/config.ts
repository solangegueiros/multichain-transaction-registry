// Everything the pages need to know about the deployment. Nothing is typed twice:
// the values come from the files the other parts of the repository already keep.
import type { Address } from "viem";
import productionProject from "../../project.config.production.json";
import stagingProject from "../../project.config.staging.json";
import productionWorkflow from "../../workflow-registry/config/config.production.json";
import stagingWorkflow from "../../workflow-registry/config/config.staging.json";

const env: Record<string, string | undefined> = import.meta.env ?? {};

/// Each environment has its own contracts on Ethereum Sepolia, in
/// project.config.<environment>.json. The app carries both and reads one at a time.
export type Environment = "staging" | "production";

const ENVIRONMENT_KEY = "environment";
const isEnvironment = (value: string | null): value is Environment => value === "staging" || value === "production";

/// Environment chosen in the footer of the menu. The address (?env=production) comes
/// first, so a shared link opens the same environment; then the last choice made in
/// this browser; then staging.
function chosenEnvironment(): Environment {
  const fromUrl = new URLSearchParams(window.location.search).get("env");
  if (isEnvironment(fromUrl)) return fromUrl;
  try {
    const saved = localStorage.getItem(ENVIRONMENT_KEY);
    if (isEnvironment(saved)) return saved;
  } catch {
    // no storage: staging
  }
  return "staging";
}

export const ENVIRONMENT: Environment = chosenEnvironment();

/// Opens the app again on the other environment. Every address and every cached read
/// belongs to one environment, so the page is loaded from scratch.
export function switchEnvironment(environment: Environment): void {
  try {
    localStorage.setItem(ENVIRONMENT_KEY, environment);
  } catch {
    // no storage: the address alone keeps the choice
  }
  const url = new URL(window.location.href);
  url.searchParams.set("env", environment);
  window.location.assign(url.toString());
}

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

/// Observer API: the same client id the workflow of the environment uses. Requests go
/// through the proxy of the environment, in vite.config.ts.
export const OBSERVER = {
  proxyPath: `/observer-api/${ENVIRONMENT}`,
  clientId: workflowConfig.apiClientId,
};
