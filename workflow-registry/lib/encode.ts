// ABI encoding of the reports MultiChainTxReceiver decodes.
// Pure module: depends only on viem, so the Hardhat tests can import it and deliver
// the encoded reports to the real contracts.
import { encodeAbiParameters, getAddress, isAddress, keccak256, parseAbiParameters, stringToHex, toBytes, type Hex } from "viem";

// ============================================================
// KEYS
// ============================================================

/// keccak256 of the normalized id, the same as keyOf / computeChainId in the contracts:
/// whitespace removed and ASCII letters lowercased.
export const keyOf = (id: string): Hex => {
  const normalized = id.replace(/[ \t\n\r]/g, "").replace(/[A-Z]/g, (c) => c.toLowerCase());
  if (normalized === "") throw new Error("Empty id");
  return keccak256(toBytes(normalized));
};

export const ZERO_BYTES32: Hex = `0x${"00".repeat(32)}`;

/// Short text as bytes32, like bytes32("LOCKED") in Solidity. "" is bytes32(0).
export const shortText = (text: string): Hex => (text === "" ? ZERO_BYTES32 : stringToHex(text, { size: 32 }));

/// A 32-byte hash written with or without the 0x prefix, in any case.
export const hash32 = (value: string, field: string): Hex => {
  const clean = value.startsWith("0x") || value.startsWith("0X") ? value.slice(2) : value;
  if (!/^[0-9a-fA-F]{64}$/.test(clean)) throw new Error(`${field} is not a 32-byte hash: "${value}"`);
  return `0x${clean.toLowerCase()}`;
};

export const isHash32 = (value: string): boolean => /^(0[xX])?[0-9a-fA-F]{64}$/.test(value);

export const address = (value: string, field: string): Hex => {
  if (!isAddress(value, { strict: false })) throw new Error(`${field} is not an address: "${value}"`);
  return getAddress(value);
};

export const uint = (value: string, field: string): bigint => {
  if (!/^\d+$/.test(value)) throw new Error(`${field} is not a non-negative integer: "${value}"`);
  return BigInt(value);
};

// ============================================================
// STRUCTS (same field order as the Solidity structs)
// ============================================================

export enum TxStatus {
  PENDING = 0,
  CONFIRMED = 1,
  FAILED = 2,
}

/// Numbers of MultiChainTxReceiver.Action.
export enum Action {
  REGISTER_TX = 0,
  UPDATE_TX_STATUS = 1,
  RECORD_ORDER_TX = 2,
  RECORD_FUND_CREATION_TX = 3,
  REGISTER_FUND = 4,
  REGISTER_ORDER = 5,
  UPDATE_ORDER_PROGRESS = 6,
}

/// Values of OrderRegistry.OrderProgress, by the name the API uses.
export const ORDER_PROGRESS: Record<string, number> = {
  AWAITING_ORIGIN: 0,
  AWAITING_DELIVERY: 1,
  ACQUIRED_WITH_LOCK: 2,
};

export type TxInput = {
  status: TxStatus;
  txHash: string;
  from: string;
  to: string;
  amount: bigint;
  assetCode: string;
  assetIssuer: string;
  txType: string;
  data: Hex;
  dataType: string;
  blockNumber: bigint;
  timestamp: bigint;
};

export type ExtraArg = { key: Hex; value: Hex };

export type FundInput = {
  fundId: string;
  fidcId: bigint;
  name: string;
  chainId: Hex;
  contractAddress: Hex;
  stableAddress: Hex;
  creationIntentHash: Hex;
  createdAt: bigint;
};

export type OrderIntent = {
  orderId: string;
  cashToken: Hex;
  validUntil: bigint;
  beneficiary: Hex;
  sourceChainId: Hex;
  sourceAccount: Hex;
  destinationChainId: Hex;
};

export type OrderTxInput = { connectorId: string; standard: string; disposition: Hex };

const TX_INPUT =
  "(uint8 status, string txHash, string from, string to, uint256 amount, string assetCode, string assetIssuer, " +
  "string txType, bytes data, string dataType, uint256 blockNumber, uint256 timestamp)";
const EXTRA_ARGS = "(bytes32 key, bytes value)[]";
const FUND_INPUT =
  "(string fundId, uint256 fidcId, string name, bytes32 chainId, address contractAddress, address stableAddress, " +
  "bytes32 creationIntentHash, uint256 createdAt)";
const ORDER_INTENT =
  "(string orderId, address cashToken, uint64 validUntil, address beneficiary, bytes32 sourceChainId, " +
  "address sourceAccount, bytes32 destinationChainId)";
const ORDER_TX_INPUT = "(string connectorId, string standard, bytes32 disposition)";
const REPORT = "(uint256 targetChainId, uint64 timestamp, uint8 action, bytes payload)";

const encode = (types: string, values: unknown[]): Hex => encodeAbiParameters(parseAbiParameters(types), values);

// ============================================================
// EXTRA ARGS
// ============================================================

/// One extra arg: the value is abi.encode(type) of it, as the schema of the chain declares.
export const extraArg = (key: string, type: string, value: unknown): ExtraArg => ({
  key: shortText(key),
  value: encode(type, [value]),
});

// ============================================================
// PAYLOADS (one per action of MultiChainTxReceiver)
// ============================================================

export const registerFundPayload = (f: FundInput, creationTx: TxInput, creationExtraArgs: ExtraArg[]): Hex =>
  encode(`${FUND_INPUT}, ${TX_INPUT}, ${EXTRA_ARGS}`, [f, creationTx, creationExtraArgs]);

export const recordFundCreationTxPayload = (fundId: string, t: TxInput, extraArgs: ExtraArg[]): Hex =>
  encode(`string, ${TX_INPUT}, ${EXTRA_ARGS}`, [fundId, t, extraArgs]);

export const registerOrderPayload = (
  orderId: string,
  fundId: string,
  intentHash: Hex,
  intent: OrderIntent,
  createdAt: bigint,
): Hex => encode(`string, string, bytes32, ${ORDER_INTENT}, uint256`, [orderId, fundId, intentHash, intent, createdAt]);

export const recordOrderTxPayload = (
  orderId: string,
  role: Hex,
  input: OrderTxInput,
  t: TxInput,
  extraArgs: ExtraArg[],
): Hex => encode(`string, bytes32, ${ORDER_TX_INPUT}, ${TX_INPUT}, ${EXTRA_ARGS}`, [orderId, role, input, t, extraArgs]);

export const updateOrderProgressPayload = (orderId: string, progress: number, version: number, updatedAt: bigint): Hex =>
  encode("string, uint8, uint32, uint256", [orderId, progress, version, updatedAt]);

// ============================================================
// REPORT
// ============================================================

/// Envelope of every report: abi.encode(MultiChainTxReceiver.Report).
/// @param targetChainId EVM chain id of the chain of the receiver.
/// @param timestamp     DON time of the execution, in seconds.
export const encodeReport = (targetChainId: bigint, timestamp: bigint, action: Action, payload: Hex): Hex =>
  encode(REPORT, [{ targetChainId, timestamp, action, payload }]);
