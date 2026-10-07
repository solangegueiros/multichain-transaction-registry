// Shared data and fixtures for the FundRegistry and OrderRegistry tests.
// Both test files use the same simulated network connection created here.
import { network } from "hardhat";

export const { ethers, networkHelpers } = await network.create();
export const { loadFixture } = networkHelpers;

export const abi = ethers.AbiCoder.defaultAbiCoder();
export const ZERO_HASH = ethers.ZeroHash;

// AccessControl role ids
export const ADMIN_ROLE = ethers.ZeroHash; // DEFAULT_ADMIN_ROLE
export const RELAYER_ROLE = ethers.id("RELAYER_ROLE");
export const OPERATOR_ROLE = ethers.id("OPERATOR_ROLE");

export enum TxStatus {
  PENDING = 0,
  CONFIRMED = 1,
  FAILED = 2,
}

export enum OrderProgress {
  AWAITING_ORIGIN = 0,
  AWAITING_DELIVERY = 1,
  ACQUIRED_WITH_LOCK = 2,
}

// Dispositions registered by the constructor (bytes32 short strings). NONE is bytes32(0):
// "no disposition", always accepted and not an entry of the list.
export const Disposition = {
  NONE: ethers.ZeroHash,
  LOCKED: ethers.encodeBytes32String("LOCKED"),
  DELIVERED: ethers.encodeBytes32String("DELIVERED"),
};

// Roles registered by the constructor (bytes32 short strings)
export const Role = {
  TRANSFER: ethers.encodeBytes32String("TRANSFER"),
  LOCK: ethers.encodeBytes32String("LOCK"),
  DELIVERY: ethers.encodeBytes32String("DELIVERY"),
};

// keccak256 of a normalized id, mirroring keyOf / computeChainId
export function keyOf(id: string): string {
  const normalized = id.replace(/[ \t\n\r]/g, "").toLowerCase();
  return ethers.keccak256(ethers.toUtf8Bytes(normalized));
}

export function key(name: string): string {
  return ethers.encodeBytes32String(name);
}

// ============================================================
// SAMPLE DATA (query-json/fund.json, order.json, orders2.json)
// ============================================================

export const CHAINS = [
  { network: "eip155:51", networkChainId: "51", name: "XDC", profileId: "xdc-apothem",
    genesisHash: "0xbdea512b4f12ff1135ec92c00dc047ffb93890c2ea1aa0eefe9b013d80640075" },
  { network: "xrpl:testnet", networkChainId: "", name: "XRPL", profileId: "", genesisHash: ZERO_HASH },
  { network: "stellar:testnet", networkChainId: "", name: "STELLAR", profileId: "", genesisHash: ZERO_HASH },
];

export const XDC_CHAIN = keyOf("eip155:51");
export const XRPL_CHAIN = keyOf("xrpl:testnet");
export const STELLAR_CHAIN = keyOf("stellar:testnet");

// Stablecoin of fund.json and fund2.json (stableAddress / stableSymbol / stableDecimals)
export const STABLE = {
  chainId: XDC_CHAIN,
  tokenAddress: "0x243e98638D619eB6f10eaBbaCfC071f318D5e9d0",
  symbol: "BRL-CVM",
  decimals: 18,
};

export function stableKeyOf(chainId: string, tokenAddress: string): string {
  return ethers.keccak256(abi.encode(["bytes32", "address"], [chainId, tokenAddress]));
}

// fund.json
export const FUND = {
  fundId: "be6f2e8a-5474-43c7-a692-7918c37e3f42",
  fidcId: 2n,
  name: "Horizonte Crédito Multirrede FIDC — Piloto XDC",
  chainId: XDC_CHAIN,
  contractAddress: "0x8001BB21f4F061b444F02f50Ab76BAA6a84394A2",
  stableAddress: STABLE.tokenAddress,
  creationIntentHash: "0x8dc7a22b8af76d37a58ebb5841e06010848186c39fa74fb4989c3182d121cba1",
  createdAt: 1789241909n, // 2026-09-12T19:38:29Z
};

export const FUND_CREATION_TX = {
  status: TxStatus.CONFIRMED,
  txHash: "0x14621df8a3245e876448ce96d475988f44f7dca038a1bc666ed189a0f204682c",
  from: "0xDF006CCB89F10CdE9736d931d46c1B9C6f22664d",
  to: FUND.contractAddress,
  amount: 0n,
  assetCode: "",
  assetIssuer: "",
  txType: "contractCall",
  data: "0x",
  dataType: "",
  blockNumber: 86700000n,
  timestamp: 0n,
};

// fund2.json (second fund, fidcId 3)
export const FUND2 = {
  ...FUND,
  fundId: "6c1f2c8c-355b-46de-a96d-85d8e70f6fa8",
  fidcId: 3n,
  name: "Fund 2",
  contractAddress: "0x8d9ac9f2fc551276805a30ab2b387c1bf1cf7f80",
  creationIntentHash: "0x" + "11".repeat(32),
};

// order.json -> items[0]
export const ORDER = {
  orderId: "8fdac770-7ca3-4a1f-a283-33efa75c96ef",
  intentHash: "0x61179240cd0bc32730b1d3f9ce88c22e6dbe2b82c5098762f5fd4f5307b1f794",
  createdAt: 1789309798n, // 2026-09-13T14:29:58Z
};

// Escrow of the order (intent.sourceController) and owner on the destination chain
// (intent.destinationOwner). Not stored in the intent: they are the `to` of the transactions.
export const SOURCE_CONTROLLER = "0xB4F6aAd0196D058353835c68B89F1F06c16490EF";
export const DESTINATION_OWNER = "rEZ8fbAwwZZvD4qXMdvHGhJXNGHi34yYwd";
export const DESTINATION2_OWNER = "GCPN5BJYXPRHGB3YIUOHSC4S6OYZKLHNIK7LYTVXRBCAPTHDYC7F7RFW";

export const INTENT = {
  orderId: ORDER.orderId,
  cashToken: FUND.stableAddress,
  validUntil: 1789324198n,
  beneficiary: "0xDF006CCB89F10CdE9736d931d46c1B9C6f22664d",
  sourceChainId: XDC_CHAIN,
  sourceAccount: FUND.contractAddress,
  destinationChainId: XRPL_CHAIN,
};

// connectorResults.source + sourceEvidence
export const TRANSFER_INFO = {
  connectorId: "evm-cash-escrow",
  standard: "ERC20_TRANSFER_TO_ORDER_ESCROW",
  disposition: Disposition.LOCKED,
};

export const SOURCE_TX = {
  status: TxStatus.CONFIRMED,
  txHash: "0xc05065f06907f834a6c68b750a8d365feca8cd0740fea6563d17738817a67233",
  from: FUND.contractAddress,
  to: SOURCE_CONTROLLER,
  amount: 100n * 10n ** 18n,
  assetCode: "BRL-CVM",
  assetIssuer: FUND.stableAddress,
  txType: "transfer",
  data: "0x",
  dataType: "",
  blockNumber: 86721398n,
  timestamp: 0n,
};

// Lock acknowledgment (connectorResults.source.lockTxHash). The JSON only has the
// hash: block, sender and target below are placeholders for the test.
export const LOCK_INFO = {
  connectorId: "evm-cash-escrow",
  standard: "",
  disposition: Disposition.NONE,
};

export const LOCK_TX = {
  status: TxStatus.CONFIRMED,
  txHash: "0x7b61fdd2d9246743e19090d184bc970b5b849e6b8c4171ac746e05448aa573a2",
  from: "0xDF006CCB89F10CdE9736d931d46c1B9C6f22664d",
  to: SOURCE_CONTROLLER,
  amount: 0n,
  assetCode: "",
  assetIssuer: "",
  txType: "contractCall",
  data: "0x",
  dataType: "",
  blockNumber: 86721400n,
  timestamp: 0n,
};

// connectorResults.destination + destinationEvidence
export const DELIVERY_INFO = {
  connectorId: "xrpl",
  standard: "XRPL_IOU",
  disposition: Disposition.DELIVERED,
};

export const DESTINATION_TX = {
  status: TxStatus.CONFIRMED,
  txHash: "9D862E426F8DE3C8F50EFEE39626318E52B1FF2A84ADE4671007A2EB71B33969",
  from: "r9aceEB7Qy5JrHtYt2KGhF4KVMgEGjoY2U",
  to: DESTINATION_OWNER,
  amount: 100n * 10n ** 6n,
  assetCode: "CVD",
  assetIssuer: "r9aceEB7Qy5JrHtYt2KGhF4KVMgEGjoY2U",
  txType: "Payment",
  data: "0x",
  dataType: "",
  blockNumber: 20726552n,
  timestamp: 0n,
};

// orders2.json -> items[0] (fund 2, Stellar destination)
export const ORDER2 = {
  orderId: "56d74d11-47ad-40b2-86fb-b9c413c1c19e",
  intentHash: "0x19011c5ad07d3dd431278b76491eea9057445c78cf9ccbcabafe759f40e36d0c",
  createdAt: 1790000000n,
};

export const INTENT2 = {
  ...INTENT,
  orderId: ORDER2.orderId,
  validUntil: 1790079109n,
  beneficiary: "0x6c1134bdd7f53e5f87ea15a184099e17a4d0712b",
  sourceAccount: FUND2.contractAddress,
  destinationChainId: STELLAR_CHAIN,
};

export const DELIVERY2_INFO = {
  connectorId: "stellar",
  standard: "STELLAR_CREDIT",
  disposition: Disposition.DELIVERED,
};

export const DESTINATION2_TX = {
  status: TxStatus.CONFIRMED,
  txHash: "03ccf55d6ddc471b7bcd77d5c2cb95137fb48765a975d3cf5996c54d4bc194a3",
  from: "GDAHUE7RJ3RZ4PRTS7ZVJ2G6H4OLCSW3BLPEFAJ7XSLBQAMGQV4OXMFL",
  to: DESTINATION2_OWNER,
  amount: 6000n * 10n ** 7n,
  assetCode: "CVD",
  assetIssuer: "GDRR62CPM7TD4OHVZC6ZIBUUD3O4M7TWWOXZ4VHCWK3QTJ34PC3SZX54",
  txType: "payment",
  data: "0x",
  dataType: "",
  blockNumber: 4793929n,
  timestamp: 0n,
};

// ============================================================
// FIXTURES
// ============================================================

/// The three contracts deployed, the three chains registered, FundRegistry (`funds`)
/// and OrderRegistry (`registry`) granted RELAYER_ROLE and `operator` granted
/// OPERATOR_ROLE in both. No stablecoin yet.
export async function baseFixture() {
  const [owner, operator, other] = await ethers.getSigners();

  const txRegistry = await ethers.deployContract("MultiChainTxRegistry");
  await txRegistry.waitForDeployment();

  for (const c of CHAINS) {
    await txRegistry.registerChain(c.network, c.networkChainId, c.name, c.profileId, c.genesisHash);
  }

  const funds = await ethers.deployContract("FundRegistry", [await txRegistry.getAddress()]);
  await funds.waitForDeployment();

  const registry = await ethers.deployContract("OrderRegistry", [await txRegistry.getAddress(), await funds.getAddress()]);
  await registry.waitForDeployment();

  await txRegistry.grantRole(RELAYER_ROLE, await funds.getAddress());
  await txRegistry.grantRole(RELAYER_ROLE, await registry.getAddress());
  await funds.grantRole(OPERATOR_ROLE, operator.address);
  await registry.grantRole(OPERATOR_ROLE, operator.address);

  return { txRegistry, funds, registry, owner, operator, other };
}

/// baseFixture plus the BRL-CVM stablecoin registered on the XDC chain.
export async function deployFixture() {
  const base = await baseFixture();
  const { funds, operator } = base;

  await funds.connect(operator).registerStableCoin(STABLE.chainId, STABLE.tokenAddress, STABLE.symbol, STABLE.decimals);

  return base;
}

/// deployFixture plus FUND registered without its creation transaction.
export async function fundFixture() {
  const base = await deployFixture();
  const { funds, operator } = base;

  await funds.connect(operator).registerFund(FUND, { ...FUND_CREATION_TX, txHash: "" }, []);

  return { ...base, fundKey: keyOf(FUND.fundId) };
}

/// fundFixture plus ORDER registered (no transactions yet).
export async function orderFixture() {
  const base = await fundFixture();
  const { registry, operator } = base;

  await registry.connect(operator).registerOrder(ORDER.orderId, FUND.fundId, ORDER.intentHash, INTENT, ORDER.createdAt);

  return { ...base, orderKey: keyOf(ORDER.orderId) };
}

/// orderFixture plus the transfer (index 0, tx 1) and the delivery (index 1, tx 2).
export async function txsFixture() {
  const base = await orderFixture();
  const { registry, operator } = base;

  await registry.connect(operator).recordOrderTx(ORDER.orderId, Role.TRANSFER, TRANSFER_INFO, SOURCE_TX, []);
  await registry.connect(operator).recordOrderTx(ORDER.orderId, Role.DELIVERY, DELIVERY_INFO, DESTINATION_TX, []);

  return base;
}
