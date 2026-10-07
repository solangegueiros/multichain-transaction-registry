import { existsSync, readFileSync, writeFileSync } from "node:fs";

/// Public project configuration, shared by every part of the repository
/// (smart contracts, frontend, workflow). It lives in project.config.json at the
/// repository root and is safe to commit. Secrets live in .env, also at the root.
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
  /// Hardhat network of the deployment, e.g. "sepolia"
  network: string;
  /// Option that caused the replacement: "--force" or "--only <contract>"
  reason: string;
  /// Names of the contracts that were replaced
  replaced: string[];
  /// project.config.json before the replacement
  config: ProjectConfig;
}

/// Repository root, resolved from this file so it does not depend on the
/// directory the command is run from.
export const repoRootUrl = new URL("../", import.meta.url);

const configUrl = new URL("project.config.json", repoRootUrl);
const backupUrl = new URL("project.backup.config.json", repoRootUrl);

/// Fields missing from the file (e.g. a file written before a contract existed)
/// are read as empty.
export const projectConfig: ProjectConfig = {
  rpcUrl: "",
  multiChainTxRegistryAddress: "",
  fundRegistryAddress: "",
  orderRegistryAddress: "",
  creForwarderAddress: "",
  multiChainTxReceiverAddress: "",
  ...JSON.parse(readFileSync(configUrl, "utf8")),
};

/// Writes the configuration back to project.config.json (used by the deploy script
/// to record the address of each contract it deploys).
export function saveProjectConfig(config: ProjectConfig): void {
  writeFileSync(configUrl, JSON.stringify(config, null, 2) + "\n");
}

/// Appends an entry to project.backup.config.json (created on first use). The file
/// is a list, oldest entry first, so earlier backups are never overwritten.
export function appendConfigBackup(entry: ConfigBackupEntry): void {
  const entries: ConfigBackupEntry[] = existsSync(backupUrl) ? JSON.parse(readFileSync(backupUrl, "utf8")) : [];
  entries.push(entry);
  writeFileSync(backupUrl, JSON.stringify(entries, null, 2) + "\n");
}
