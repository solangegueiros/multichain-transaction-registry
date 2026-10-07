// Chains tracked by the project, shared by the scripts that need them.
// Chains found in query-json/ (see MultiChainTxRegistry.md)
export const CHAINS = [
  {
    network: "eip155:51",
    networkChainId: "51",
    name: "XDC",
    profileId: "xdc-apothem",
    genesisHash: "0xbdea512b4f12ff1135ec92c00dc047ffb93890c2ea1aa0eefe9b013d80640075",
  },
  {
    network: "xrpl:testnet",
    networkChainId: "",
    name: "XRPL",
    profileId: "",
    genesisHash: "0x" + "00".repeat(32),
  },
  {
    network: "stellar:testnet",
    networkChainId: "",
    name: "STELLAR",
    profileId: "",
    genesisHash: "0x" + "00".repeat(32),
  },
  {
    network: "eip155:80002",
    networkChainId: "80002",
    name: "POLYGON",
    profileId: "polygon-amoy",
    genesisHash: "0x7202b2b53c5a0836e773e319d18922cc756dd67432f9a1f65352b61f4406c697",
  },
  {
    network: "eip155:50",
    networkChainId: "50",
    name: "XDC",
    profileId: "xdc-mainnet",
    genesisHash: "0x4a9d748bd78a8d0385b67788c2435dcdb914f98a96250b68863a1f8b7642d6b1",
  },
  {
    // Rayls: genesis hash not provided by the source, kept as zero
    network: "eip155:7295799",
    networkChainId: "7295799",
    name: "RAYLS",
    profileId: "",
    genesisHash: "0x" + "00".repeat(32),
  },
];

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

export const SCHEMA_KEYS_BY_NETWORK = [
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
