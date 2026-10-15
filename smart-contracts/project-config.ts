import { existsSync, readFileSync, writeFileSync } from "node:fs";

/// Public project configuration, shared by every part of the repository
/// (smart contracts, frontend, workflow). There is one file per environment at the
/// repository root, project.config.<environment>.json, safe to commit. Secrets live
/// in .env, also at the root.
export interface ProjectConfig {
  /// Ethereum Sepolia RPC URL, without an embedded API key
  rpcUrl: string;
  /// Deployed MultiChainTxRegistry ("" until it is deployed)
  multiChainTxRegistryAddress: string;
  /// Deployed FundRegistry ("" until it is deployed)
  fundRegistryAddress: string;
  /// Deployed OrderRegistry ("" until it is deployed)
  orderRegistryAddress: string;
  /// Chainlink CRE forwarder that delivers reports to MultiChainTxReceiver: the
  /// KeystoneForwarder of the network for deployed workflows, or the MockKeystoneForwarder
  /// for `cre workflow simulate --broadcast`. "" = the MockKeystoneForwarder of Ethereum
  /// Sepolia is used (see scripts/deploy-cre-receiver.ts).
  creForwarderAddress: string;
  /// Deployed MultiChainTxReceiver ("" until it is deployed)
  multiChainTxReceiverAddress: string;
  /// Id of the deployed Chainlink CRE workflow, shown by `cre workflow deploy`. When
  /// filled, the receiver accepts reports of this workflow only (setExpectedWorkflowId).
  /// "" = the restriction of the receiver is left as it is (see scripts/deploy-cre-receiver.ts).
  creWorkflowId: string;
}

/// Fields of ProjectConfig that hold the address of a deployed contract.
export type AddressKey =
  | "multiChainTxRegistryAddress"
  | "fundRegistryAddress"
  | "orderRegistryAddress"
  | "multiChainTxReceiverAddress";

/// One entry of project.backup.config.json: the configuration as it was right
/// before deployed contracts were replaced.
export interface ConfigBackupEntry {
  /// When the backup was taken (ISO 8601, UTC)
  savedAt: string;
  /// Hardhat network of the deployment, which is also its environment: "staging" or "production"
  network: string;
  /// Option that caused the replacement: "--force" or "--only <contract>"
  reason: string;
  /// Names of the contracts that were replaced
  replaced: string[];
  /// project.config.<environment>.json before the replacement
  config: ProjectConfig;
}

/// Repository root, resolved from this file so it does not depend on the
/// directory the command is run from.
export const repoRootUrl = new URL("../", import.meta.url);

const backupUrl = new URL("project.backup.config.json", repoRootUrl);

/// Each environment has its own contracts and its own project.config.<environment>.json.
/// Both are on Ethereum Sepolia.
export type Environment = "staging" | "production";

export const ENVIRONMENTS: Environment[] = ["staging", "production"];

/// Environment of a Hardhat network: the networks are named after the environments.
/// The local simulated network reads staging, but the scripts ignore its addresses there.
export function environmentOf(networkName: string): Environment {
  return networkName === "production" ? "production" : "staging";
}

/// Name of the file of the environment, as shown in messages.
export function projectConfigFile(environment: Environment): string {
  return `project.config.${environment}.json`;
}

const configUrl = (environment: Environment) => new URL(projectConfigFile(environment), repoRootUrl);

/// Configuration of the environment. Fields missing from the file (e.g. a file
/// written before a contract existed) are read as empty.
export function loadProjectConfig(environment: Environment): ProjectConfig {
  return {
    rpcUrl: "",
    multiChainTxRegistryAddress: "",
    fundRegistryAddress: "",
    orderRegistryAddress: "",
    creForwarderAddress: "",
    multiChainTxReceiverAddress: "",
    creWorkflowId: "",
    ...JSON.parse(readFileSync(configUrl(environment), "utf8")),
  };
}

/// Writes the configuration back to the file of the environment (used by the deploy
/// scripts to record the address of each contract they deploy).
export function saveProjectConfig(environment: Environment, config: ProjectConfig): void {
  writeFileSync(configUrl(environment), JSON.stringify(config, null, 2) + "\n");
}

/// Appends an entry to project.backup.config.json (created on first use). The file
/// is a list, oldest entry first, so earlier backups are never overwritten.
export function appendConfigBackup(entry: ConfigBackupEntry): void {
  const entries: ConfigBackupEntry[] = existsSync(backupUrl) ? JSON.parse(readFileSync(backupUrl, "utf8")) : [];
  entries.push(entry);
  writeFileSync(backupUrl, JSON.stringify(entries, null, 2) + "\n");
}
