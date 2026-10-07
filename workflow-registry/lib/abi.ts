// Read functions of the registries the workflow calls to learn what is already onchain.
import { parseAbi } from "viem";

export const TX_REGISTRY_ABI = parseAbi([
  // public mapping of ChainInfo: chainId is bytes32(0) when the network is not registered
  "function chains(bytes32) view returns (bytes32 chainId, string network, string networkChainId, string name, string profileId, bytes32 genesisHash)",
]);

export const FUND_REGISTRY_ABI = parseAbi([
  "struct ChainInfo { bytes32 chainId; string network; string networkChainId; string name; string profileId; bytes32 genesisHash; }",
  "struct StableCoin { bytes32 stableKey; bytes32 chainId; address tokenAddress; string symbol; uint8 decimals; }",
  "struct Fund { bytes32 fundKey; string fundId; uint256 fidcId; string name; ChainInfo chain; address contractAddress; StableCoin stable; bytes32 creationIntentHash; string creationTxHash; uint256 creationTxId; uint256 createdAt; }",
  "function listFunds(uint256 fromIndex, uint256 toIndex) view returns (Fund[])",
  "function listStableCoins() view returns (StableCoin[])",
]);

export const ORDER_REGISTRY_ABI = parseAbi([
  "struct OrderSyncState { bool registered; uint8 progress; uint32 version; uint256 createdAt; uint256 updatedAt; bytes32[] roles; }",
  "function getOrderSyncStates(string[] orderIds) view returns (OrderSyncState[])",
]);
