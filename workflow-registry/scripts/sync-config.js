#!/usr/bin/env node
// Copies the contract addresses from project.config.json (repository root) to the
// workflow configs that write onchain. Run it after deploying the contracts, so the
// workflow and the deploy scripts never point to different contracts.
import { readFileSync, writeFileSync } from "node:fs";

const projectConfig = JSON.parse(readFileSync(new URL("../../project.config.json", import.meta.url), "utf8"));

// field of the workflow config <- field of project.config.json
const FIELDS = {
  receiverAddress: "multiChainTxReceiverAddress",
  txRegistryAddress: "multiChainTxRegistryAddress",
  fundRegistryAddress: "fundRegistryAddress",
  orderRegistryAddress: "orderRegistryAddress",
};

const missing = Object.values(FIELDS).filter((field) => !projectConfig[field]);
if (missing.length !== 0) {
  console.error(`Empty in project.config.json: ${missing.join(", ")}. Deploy the contracts first.`);
  process.exit(1);
}

for (const name of ["config.staging.json", "config.production.json"]) {
  const url = new URL(`../config/${name}`, import.meta.url);
  const config = JSON.parse(readFileSync(url, "utf8"));

  const changed = [];
  for (const [field, source] of Object.entries(FIELDS)) {
    if (config[field] === projectConfig[source]) continue;
    config[field] = projectConfig[source];
    changed.push(field);
  }

  if (changed.length === 0) {
    console.log(`${name}: already up to date`);
    continue;
  }
  writeFileSync(url, JSON.stringify(config, null, 2) + "\n");
  console.log(`${name}: updated ${changed.join(", ")}`);
}
