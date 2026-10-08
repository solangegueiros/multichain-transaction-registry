// Block explorers of the networks the registry tracks, by network id.
const TX_URL: Record<string, string> = {
  "eip155:51": "https://testnet.xdcscan.com/tx/",
  "eip155:50": "https://xdcscan.com/tx/",
  "eip155:80002": "https://amoy.polygonscan.com/tx/",
  "eip155:11155111": "https://sepolia.etherscan.io/tx/",
  "xrpl:testnet": "https://testnet.xrpl.org/transactions/",
  "stellar:testnet": "https://stellar.expert/explorer/testnet/tx/",
};

/// Link to a transaction on the explorer of its network, or null when none is known.
export const txUrl = (network: string, txHash: string): string | null =>
  TX_URL[network] && txHash !== "" ? TX_URL[network] + txHash : null;
