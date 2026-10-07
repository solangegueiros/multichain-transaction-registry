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
