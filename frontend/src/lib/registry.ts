// Reads of the contracts. Read only: this app never sends a transaction.
import {
  createPublicClient,
  decodeAbiParameters,
  encodePacked,
  hexToString,
  http,
  keccak256,
  type Address,
  type Hex,
} from "viem";
import { sepolia } from "viem/chains";
import { fundRegistryAbi } from "../abi/FundRegistry";
import { multiChainTxReceiverAbi } from "../abi/MultiChainTxReceiver";
import { multiChainTxRegistryAbi } from "../abi/MultiChainTxRegistry";
import { orderRegistryAbi } from "../abi/OrderRegistry";
import { CONTRACTS, CUSTOM_RPC, RPC_URL } from "../config";

// On Sepolia, calls made together are grouped in one request (Multicall3). Another node,
// such as a local one, may not have that contract: there each call goes on its own.
export const client = createPublicClient({
  chain: CUSTOM_RPC ? undefined : sepolia,
  transport: http(RPC_URL),
  batch: CUSTOM_RPC ? undefined : { multicall: true },
});

const required = (address: Address | null, name: string): Address => {
  if (!address) throw new Error(`${name} is not deployed: its address is empty in project.config.json`);
  return address;
};

const tx = () => ({ address: required(CONTRACTS.txRegistry, "MultiChainTxRegistry"), abi: multiChainTxRegistryAbi }) as const;
const funds = () => ({ address: required(CONTRACTS.fundRegistry, "FundRegistry"), abi: fundRegistryAbi }) as const;
const orders = () => ({ address: required(CONTRACTS.orderRegistry, "OrderRegistry"), abi: orderRegistryAbi }) as const;
const receiver = () =>
  ({ address: required(CONTRACTS.receiver, "MultiChainTxReceiver"), abi: multiChainTxReceiverAbi }) as const;

// ============================================================
// HELPERS
// ============================================================

export const ZERO_BYTES32: Hex = `0x${"00".repeat(32)}`;

/// Text of a bytes32 short string, as bytes32("LOCKED"). "" for bytes32(0).
export const shortText = (value: Hex): string => hexToString(value, { size: 32 }).replace(/\u0000/g, "");

export const PROGRESS = ["AWAITING_ORIGIN", "AWAITING_DELIVERY", "ACQUIRED_WITH_LOCK"];
export const TX_STATUS = ["PENDING", "CONFIRMED", "FAILED"];

const range = (n: number | bigint): bigint[] => Array.from({ length: Number(n) }, (_, i) => BigInt(i));

/// Same normalization the contracts apply to ids and transaction hashes.
const normalize = (text: string): string => text.replace(/[ \t\n\r]/g, "").replace(/[A-Z]/g, (c) => c.toLowerCase());

// ============================================================
// CHAINS
// ============================================================

export type SchemaKey = { key: string; valueType: string; description: string; required: boolean; active: boolean };

export type Chain = {
  chainId: Hex;
  network: string;
  networkChainId: string;
  name: string;
  profileId: string;
  genesisHash: Hex;
  schema: SchemaKey[];
};

export async function getChains(): Promise<Chain[]> {
  const count = await client.readContract({ ...tx(), functionName: "getChainCount" });
  const ids = await Promise.all(range(count).map((i) => client.readContract({ ...tx(), functionName: "chainIds", args: [i] })));
  const infos = await Promise.all(ids.map((id) => client.readContract({ ...tx(), functionName: "chains", args: [id] })));
  const schemas = await Promise.all(
    infos.map((info) => client.readContract({ ...tx(), functionName: "getSchema", args: [info[1]] })),
  );

  return infos.map(([chainId, network, networkChainId, name, profileId, genesisHash], i) => ({
    chainId,
    network,
    networkChainId,
    name,
    profileId,
    genesisHash,
    schema: schemas[i].map((s) => ({ ...s, key: shortText(s.key) })),
  }));
}

// ============================================================
// FUNDS
// ============================================================

export async function getStableCoins() {
  return client.readContract({ ...funds(), functionName: "listStableCoins" });
}

export async function getFunds() {
  return client.readContract({ ...funds(), functionName: "listFunds", args: [0n, 0n] });
}

export type Fund = Awaited<ReturnType<typeof getFunds>>[number];

/// The fund, or null when it is not registered.
export async function getFund(fundId: string): Promise<Fund | null> {
  const all = await getFunds();
  const key = keccak256(new TextEncoder().encode(normalize(fundId)));
  return all.find((f) => f.fundKey === key) ?? null;
}

// ============================================================
// ORDERS
// ============================================================

export type OrderSummary = {
  orderId: string;
  registered: boolean;
  progress: number;
  version: number;
  createdAt: bigint;
  updatedAt: bigint;
  roles: string[];
};

/// Sync state of many orders. The contract call is split so that each one stays small.
export async function getOrderStates(orderIds: string[]): Promise<OrderSummary[]> {
  const chunks: string[][] = [];
  for (let i = 0; i < orderIds.length; i += 30) chunks.push(orderIds.slice(i, i + 30));

  const replies = await Promise.all(
    chunks.map((ids) => client.readContract({ ...orders(), functionName: "getOrderSyncStates", args: [ids] })),
  );
  return replies.flat().map((s, i) => ({
    orderId: orderIds[i],
    registered: s.registered,
    progress: s.progress,
    version: s.version,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    roles: s.roles.map(shortText),
  }));
}

/// Orders of a fund, with the state of each one.
export async function getOrdersOfFund(fundId: string): Promise<OrderSummary[]> {
  const ids = await client.readContract({ ...orders(), functionName: "getOrdersByFund", args: [fundId] });
  return getOrderStates([...ids]);
}

export type ExtraArg = { key: string; valueType: string; value: string };

export type RegisteredTx = {
  id: bigint;
  chainId: Hex;
  status: number;
  txHash: string;
  from: string;
  to: string;
  amount: bigint;
  assetCode: string;
  assetIssuer: string;
  txType: string;
  blockNumber: bigint;
  registeredAt: bigint;
  registeredBy: Address;
};

/// Extra args of a transaction, decoded with the value types of the schema of its chain.
export async function getExtraArgs(txId: bigint, chain: Chain | undefined): Promise<ExtraArg[]> {
  const args = await client.readContract({ ...tx(), functionName: "getExtraArgs", args: [txId] });
  return args.map((arg) => {
    const key = shortText(arg.key);
    const valueType = chain?.schema.find((s) => s.key === key)?.valueType ?? "";
    let value: string = arg.value;
    try {
      if (valueType !== "") value = String(decodeAbiParameters([{ type: valueType }], arg.value)[0]);
    } catch {
      // unknown or mismatching type: the raw bytes are shown
    }
    return { key, valueType, value };
  });
}

export type OrderTxEntry = {
  index: number;
  role: string;
  connectorId: string;
  standard: string;
  disposition: string;
  tx: RegisteredTx;
  extraArgs: ExtraArg[];
};

export type OrderDetail = {
  order: Awaited<ReturnType<typeof readOrder>>;
  intent: Awaited<ReturnType<typeof readIntent>>;
  txs: OrderTxEntry[];
};

const readOrder = (orderId: string) => client.readContract({ ...orders(), functionName: "getOrder", args: [orderId] });
const readIntent = (orderId: string) =>
  client.readContract({ ...orders(), functionName: "getOrderIntent", args: [orderId] });

/// The order with its intent and its transactions, or null when it is not registered.
export async function getOrderDetail(orderId: string, chains: Chain[]): Promise<OrderDetail | null> {
  const [state] = await getOrderStates([orderId]);
  if (!state.registered) return null;

  const [order, intent, count] = await Promise.all([
    readOrder(orderId),
    readIntent(orderId),
    client.readContract({ ...orders(), functionName: "getOrderTxCount", args: [orderId] }),
  ]);

  const entries = await Promise.all(
    range(count).map((i) => client.readContract({ ...orders(), functionName: "getOrderTx", args: [orderId, i] })),
  );
  const extraArgs = await Promise.all(
    entries.map(([, txData]) =>
      getExtraArgs(
        txData.id,
        chains.find((c) => c.chainId === txData.chainId),
      ),
    ),
  );

  return {
    order,
    intent,
    txs: entries.map(([orderTx, txData], index) => ({
      index,
      role: shortText(orderTx.role),
      connectorId: orderTx.connectorId,
      standard: orderTx.standard,
      disposition: shortText(orderTx.disposition),
      tx: txData,
      extraArgs: extraArgs[index],
    })),
  };
}

// ============================================================
// TRANSACTIONS
// ============================================================

export async function getTxCount(): Promise<bigint> {
  return client.readContract({ ...tx(), functionName: "txCount" });
}

/// Transactions with ids from `fromId` down to `toId`, newest first. Ids start at 1.
export async function getTxs(fromId: bigint, toId: bigint): Promise<RegisteredTx[]> {
  const ids: bigint[] = [];
  for (let id = fromId; id >= toId && id >= 1n; id--) ids.push(id);
  return Promise.all(ids.map((id) => client.readContract({ ...tx(), functionName: "getTx", args: [id] })));
}

/// Transaction registered with this hash on this chain, or null.
export async function findTxByHash(chainId: Hex, txHash: string): Promise<RegisteredTx | null> {
  const indexKey = keccak256(encodePacked(["bytes32", "string"], [chainId, normalize(txHash)]));
  const id = await client.readContract({ ...tx(), functionName: "txIndex", args: [indexKey] });
  if (id === 0n) return null;
  return client.readContract({ ...tx(), functionName: "getTx", args: [id] });
}

// ============================================================
// OVERVIEW AND SETUP
// ============================================================

export async function getCounts() {
  const [chains, txs, stableCoins, fundList] = await Promise.all([
    client.readContract({ ...tx(), functionName: "getChainCount" }),
    client.readContract({ ...tx(), functionName: "txCount" }),
    client.readContract({ ...funds(), functionName: "getStableCoinCount" }),
    getFunds(),
  ]);
  const perFund = await Promise.all(
    fundList.map((f) => client.readContract({ ...orders(), functionName: "getOrdersByFund", args: [f.fundId] })),
  );
  return {
    chains: Number(chains),
    txs: Number(txs),
    stableCoins: Number(stableCoins),
    funds: fundList.length,
    orders: perFund.reduce((sum, ids) => sum + ids.length, 0),
  };
}

export async function getOrderTxLabels() {
  const [roles, dispositions] = await Promise.all([
    client.readContract({ ...orders(), functionName: "listOrderTxRoles" }),
    client.readContract({ ...orders(), functionName: "listOrderTxDispositions" }),
  ]);
  return { roles, dispositions };
}

/// State of the Chainlink CRE receiver, or null when it is not deployed.
export async function getReceiverState() {
  if (!CONTRACTS.receiver) return null;
  const r = receiver();
  const [forwarder, author, workflowName, workflowId, maxFutureSkew, orderRegistry, fundRegistry] = await Promise.all([
    client.readContract({ ...r, functionName: "getForwarderAddress" }),
    client.readContract({ ...r, functionName: "getExpectedAuthor" }),
    client.readContract({ ...r, functionName: "getExpectedWorkflowName" }),
    client.readContract({ ...r, functionName: "getExpectedWorkflowId" }),
    client.readContract({ ...r, functionName: "maxFutureSkew" }),
    client.readContract({ ...r, functionName: "orderRegistry" }),
    client.readContract({ ...r, functionName: "fundRegistry" }),
  ]);
  return { forwarder, author, workflowName, workflowId, maxFutureSkew, orderRegistry, fundRegistry };
}

export type RoleCheck = { role: string; contract: string; account: string; granted: boolean };

/// The roles each contract needs in the others for the writes to work.
export async function getRoleChecks(): Promise<RoleCheck[]> {
  const [relayer, operator] = await Promise.all([
    client.readContract({ ...tx(), functionName: "RELAYER_ROLE" }),
    client.readContract({ ...funds(), functionName: "OPERATOR_ROLE" }),
  ]);

  const wanted: { role: string; contract: string; account: string; check: () => Promise<boolean> }[] = [
    {
      role: "RELAYER_ROLE",
      contract: "MultiChainTxRegistry",
      account: "FundRegistry",
      check: () => client.readContract({ ...tx(), functionName: "hasRole", args: [relayer, funds().address] }),
    },
    {
      role: "RELAYER_ROLE",
      contract: "MultiChainTxRegistry",
      account: "OrderRegistry",
      check: () => client.readContract({ ...tx(), functionName: "hasRole", args: [relayer, orders().address] }),
    },
  ];
  if (CONTRACTS.receiver) {
    const account = CONTRACTS.receiver;
    wanted.push(
      {
        role: "RELAYER_ROLE",
        contract: "MultiChainTxRegistry",
        account: "MultiChainTxReceiver",
        check: () => client.readContract({ ...tx(), functionName: "hasRole", args: [relayer, account] }),
      },
      {
        role: "OPERATOR_ROLE",
        contract: "FundRegistry",
        account: "MultiChainTxReceiver",
        check: () => client.readContract({ ...funds(), functionName: "hasRole", args: [operator, account] }),
      },
      {
        role: "OPERATOR_ROLE",
        contract: "OrderRegistry",
        account: "MultiChainTxReceiver",
        check: () => client.readContract({ ...orders(), functionName: "hasRole", args: [operator, account] }),
      },
    );
  }

  const granted = await Promise.all(wanted.map((w) => w.check()));
  return wanted.map(({ role, contract, account }, i) => ({ role, contract, account, granted: granted[i] }));
}
