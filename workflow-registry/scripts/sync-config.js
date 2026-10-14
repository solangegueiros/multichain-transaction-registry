#!/usr/bin/env node
// Copies the contract addresses of each environment to the workflow config of the same
// environment: project.config.staging.json -> config/config.staging.json, and
// project.config.production.json -> config/config.production.json (repository root).
// Run it after deploying the contracts, so the workflow and the deploy scripts never
// point to different contracts.
import { readFileSync, writeFileSync } from "node:fs";

// field of the workflow config <- field of project.config.<environment>.json
const FIELDS = {
  receiverAddress: "multiChainTxReceiverAddress",
  txRegistryAddress: "multiChainTxRegistryAddress",
  fundRegistryAddress: "fundRegistryAddress",
  orderRegistryAddress: "orderRegistryAddress",
};

let failed = false;

for (const environment of ["staging", "production"]) {
  const source = `project.config.${environment}.json`;
  const name = `config.${environment}.json`;
  const projectConfig = JSON.parse(readFileSync(new URL(`../../${source}`, import.meta.url), "utf8"));

  // An environment without contracts yet is left as it is: the other one is still synced
  const missing = Object.values(FIELDS).filter((field) => !projectConfig[field]);
  if (missing.length !== 0) {
    console.error(`${name}: not updated. Empty in ${source}: ${missing.join(", ")}. Deploy the contracts first.`);
    failed = true;
    continue;
  }

  const url = new URL(`../config/${name}`, import.meta.url);
  const config = JSON.parse(readFileSync(url, "utf8"));

  const changed = [];
  for (const [field, sourceField] of Object.entries(FIELDS)) {
    if (config[field] === projectConfig[sourceField]) continue;
    config[field] = projectConfig[sourceField];
    changed.push(field);
  }

  if (changed.length === 0) {
    console.log(`${name}: already up to date`);
    continue;
  }
  writeFileSync(url, JSON.stringify(config, null, 2) + "\n");
  console.log(`${name}: updated ${changed.join(", ")}`);
}

if (failed) process.exitCode = 1;
