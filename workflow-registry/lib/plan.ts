// Decides which reports are due: compares what the Observer API says with what is
// already in the registries and returns the actions that are missing, in the order
// they must be sent. Pure module: no CRE SDK here.
import type { Hex } from "viem";
import { VERIFIED, isoToUnixSeconds, type ApiFund, type OrderDetail, type OrderIndexEntry, type OrderSide } from "./api.js";
import {
  Action,
  ORDER_PROGRESS,
  TxStatus,
  ZERO_BYTES32,
  address,
  extraArg,
  hash32,
  isHash32,
  keyOf,
  recordFundCreationTxPayload,
  recordOrderTxPayload,
  registerFundPayload,
  registerOrderPayload,
  shortText,
  uint,
  updateOrderProgressPayload,
  type ExtraArg,
  type TxInput,
} from "./encode.js";

// ============================================================
// TYPES
// ============================================================

/// One report to send: an action of MultiChainTxReceiver and its payload.
export type PlannedAction = {
  action: Action;
  name: string; // name of the action, for the logs
  ref: string; // what it is about: "fund <id>", "order <id> TRANSFER"
  payload: Hex;
  /// Network that must be registered in MultiChainTxRegistry for the action to succeed.
  requiresNetwork?: string;
};

/// What FundRegistry has about a fund.
export type FundState = {
  registered: boolean;
  creationTxLinked: boolean;
  stableSymbol: string; // "" when not registered
};

/// What OrderRegistry has about an order.
export type OrderState = {
  registered: boolean;
  progress: number;
  version: number;
  createdAt: bigint;
  updatedAt: bigint;
  roles: Hex[]; // role of each transaction already recorded
};

export const UNREGISTERED_FUND: FundState = { registered: false, creationTxLinked: false, stableSymbol: "" };

export const UNREGISTERED_ORDER: OrderState = {
  registered: false,
  progress: 0,
  version: 0,
  createdAt: 0n,
  updatedAt: 0n,
  roles: [],
};

/// Roles registered by the constructor of OrderRegistry.
export const ROLE = {
  TRANSFER: shortText("TRANSFER"),
  LOCK: shortText("LOCK"),
  DELIVERY: shortText("DELIVERY"),
};

// ============================================================
// FUND
// ============================================================

/// Creation transaction of a fund. The API only gives its hash: the other fields
/// stay empty.
const fundCreationTx = (fund: ApiFund): TxInput => ({
  status: TxStatus.CONFIRMED,
  txHash: fund.creationTxHash,
  from: "",
  to: fund.contractAddress,
  amount: 0n,
  assetCode: "",
  assetIssuer: "",
  txType: "contractCall",
  data: "0x",
  dataType: "",
  blockNumber: 0n,
  timestamp: 0n,
});

/// REGISTER_FUND when the fund is not registered; RECORD_FUND_CREATION_TX when it is,
/// its creation transaction is not linked yet and the API now has the hash.
export const planFund = (fund: ApiFund, state: FundState): PlannedAction[] => {
  const ref = `fund ${fund.fundId}`;

  if (!state.registered) {
    const payload = registerFundPayload(
      {
        fundId: fund.fundId,
        fidcId: uint(fund.fidcId, "fidcId"),
        name: fund.name,
        chainId: keyOf(fund.network),
        contractAddress: address(fund.contractAddress, "contractAddress"),
        stableAddress: address(fund.stableAddress, "stableAddress"),
        creationIntentHash:
          fund.creationIntentHash === "" ? ZERO_BYTES32 : hash32(fund.creationIntentHash, "creationIntentHash"),
        createdAt: isoToUnixSeconds(fund.createdAt),
      },
      fundCreationTx(fund),
      [],
    );
    return [{ action: Action.REGISTER_FUND, name: "REGISTER_FUND", ref, payload, requiresNetwork: fund.network }];
  }

  if (!state.creationTxLinked && fund.creationTxHash !== "") {
    const payload = recordFundCreationTxPayload(fund.fundId, fundCreationTx(fund), []);
    return [{ action: Action.RECORD_FUND_CREATION_TX, name: "RECORD_FUND_CREATION_TX", ref, payload }];
  }

  return [];
};

// ============================================================
// ORDER
// ============================================================

const confirmed = (side: OrderSide): boolean => side.status === VERIFIED && side.txHash !== "";

/// Extra args of a transaction, by network. The keys are the ones registered by
/// scripts/register-chains.ts; a key the network does not have makes the registry revert.
const extraArgsOf = (side: OrderSide): ExtraArg[] => {
  const args: ExtraArg[] = [];
  const ledgerHash = side.ledgerHash !== "" ? side.ledgerHash : side.blockHash;

  if (side.network.startsWith("eip155:")) {
    if (isHash32(side.blockHash)) args.push(extraArg("blockHash", "bytes32", hash32(side.blockHash, "blockHash")));
    if (/^\d+$/.test(side.logIndex)) args.push(extraArg("logIndex", "uint256", BigInt(side.logIndex)));
    if (side.verificationScope !== "") args.push(extraArg("verificationScope", "string", side.verificationScope));
  } else if (side.network.startsWith("xrpl:")) {
    if (isHash32(ledgerHash)) args.push(extraArg("ledgerHash", "bytes32", hash32(ledgerHash, "ledgerHash")));
    if (/^\d+$/.test(side.sequence)) args.push(extraArg("sequence", "uint32", Number(side.sequence)));
  } else if (side.network.startsWith("stellar:")) {
    if (isHash32(ledgerHash)) args.push(extraArg("ledgerHash", "bytes32", hash32(ledgerHash, "ledgerHash")));
    if (/^\d+$/.test(side.sequence)) args.push(extraArg("sequence", "uint64", BigInt(side.sequence)));
  }
  return args;
};

/// Transaction of one side of the order (the transfer or the delivery).
const sideTx = (side: OrderSide, defaultAssetCode: string): TxInput => ({
  status: TxStatus.CONFIRMED,
  txHash: side.txHash,
  from: side.from,
  to: side.to,
  amount: uint(side.amountUnits, "amountUnits"),
  assetCode: side.assetCode !== "" ? side.assetCode : defaultAssetCode,
  assetIssuer: side.assetIssuer !== "" ? side.assetIssuer : side.assetId,
  txType: side.txType !== "" ? side.txType : "transfer",
  data: "0x",
  dataType: "",
  blockNumber: /^\d+$/.test(side.blockNumber) ? BigInt(side.blockNumber) : 0n,
  timestamp: 0n,
});

/// Progress update to send, or null when OrderRegistry already has it or would
/// reject it. Mirrors the checks of OrderRegistry.updateOrderProgress.
export const progressDue = (
  progressName: string,
  versionText: string,
  updatedAtIso: string,
  current: OrderState,
): { progress: number; version: number; updatedAt: bigint } | null => {
  const progress = ORDER_PROGRESS[progressName];
  if (progress === undefined || !/^\d+$/.test(versionText)) return null;

  const version = Number(versionText);
  const updatedAt = isoToUnixSeconds(updatedAtIso);

  if (progress === current.progress && version === current.version) return null;
  if (version < current.version || updatedAt < current.createdAt) return null;
  const newer = updatedAt > current.updatedAt || (current.version === 0 && updatedAt === current.createdAt);
  return newer ? { progress, version, updatedAt } : null;
};

/// Whether the order needs any report, judged from the index entry alone.
export const needsWork = (entry: OrderIndexEntry, state: OrderState): boolean => {
  if (!state.registered) return true;
  if (entry.hasTransfer && !state.roles.includes(ROLE.TRANSFER)) return true;
  if (entry.hasLock && !state.roles.includes(ROLE.LOCK)) return true;
  if (entry.hasDelivery && !state.roles.includes(ROLE.DELIVERY)) return true;
  return progressDue(entry.progress, entry.version, entry.updatedAt, state) !== null;
};

/// Reports an order needs, in order: REGISTER_ORDER, one RECORD_ORDER_TX for each
/// confirmed transaction not recorded yet (transfer, lock, delivery) and
/// UPDATE_ORDER_PROGRESS.
/// @param fundId       fund the workflow is processing: the order must belong to it.
/// @param stableSymbol symbol of the stablecoin of the fund, the asset of the transfer.
export const planOrder = (order: OrderDetail, fundId: string, stableSymbol: string, state: OrderState): PlannedAction[] => {
  const actions: PlannedAction[] = [];
  const { intent, source, destination } = order;
  const ref = `order ${order.id}`;
  let current = state;

  if (keyOf(intent.fundId) !== keyOf(fundId)) throw new Error(`intent.fundId is "${intent.fundId}", expected "${fundId}"`);

  if (!current.registered) {
    const createdAt = isoToUnixSeconds(order.createdAt);
    const payload = registerOrderPayload(
      order.id,
      fundId,
      hash32(order.intentHash, "intentHash"),
      {
        orderId: intent.orderId,
        cashToken: address(intent.cashToken, "intent.cashToken"),
        validUntil: uint(intent.validUntil, "intent.validUntil"),
        beneficiary: address(intent.beneficiary, "intent.beneficiary"),
        sourceChainId: keyOf(intent.sourceNetwork),
        sourceAccount: address(intent.sourceAccount, "intent.sourceAccount"),
        destinationChainId: keyOf(intent.destinationNetwork),
      },
      createdAt,
    );
    actions.push({
      action: Action.REGISTER_ORDER,
      name: "REGISTER_ORDER",
      ref,
      payload,
      requiresNetwork: intent.destinationNetwork,
    });
    // State of an order right after registerOrder
    current = { registered: true, progress: 0, version: 0, createdAt, updatedAt: createdAt, roles: [] };
  }

  if (confirmed(source) && !current.roles.includes(ROLE.TRANSFER)) {
    const payload = recordOrderTxPayload(
      order.id,
      ROLE.TRANSFER,
      { connectorId: source.connectorId, standard: source.standard, disposition: shortText(source.disposition) },
      sideTx(source, stableSymbol),
      extraArgsOf(source),
    );
    actions.push({ action: Action.RECORD_ORDER_TX, name: "RECORD_ORDER_TX", ref: `${ref} TRANSFER`, payload });
  }

  // Lock acknowledgment. The API only gives its hash; it is sent to the escrow of the order.
  if (source.lockTxHash !== "" && !current.roles.includes(ROLE.LOCK)) {
    const lockTx: TxInput = {
      status: TxStatus.CONFIRMED,
      txHash: source.lockTxHash,
      from: "",
      to: intent.sourceController,
      amount: 0n,
      assetCode: "",
      assetIssuer: "",
      txType: "contractCall",
      data: "0x",
      dataType: "",
      blockNumber: 0n,
      timestamp: 0n,
    };
    const payload = recordOrderTxPayload(
      order.id,
      ROLE.LOCK,
      { connectorId: source.connectorId, standard: "", disposition: ZERO_BYTES32 },
      lockTx,
      [],
    );
    actions.push({ action: Action.RECORD_ORDER_TX, name: "RECORD_ORDER_TX", ref: `${ref} LOCK`, payload });
  }

  if (confirmed(destination) && !current.roles.includes(ROLE.DELIVERY)) {
    const payload = recordOrderTxPayload(
      order.id,
      ROLE.DELIVERY,
      {
        connectorId: destination.connectorId,
        standard: destination.standard,
        disposition: shortText(destination.disposition),
      },
      sideTx(destination, ""),
      extraArgsOf(destination),
    );
    actions.push({ action: Action.RECORD_ORDER_TX, name: "RECORD_ORDER_TX", ref: `${ref} DELIVERY`, payload });
  }

  const due = progressDue(order.progress, order.version, order.updatedAt, current);
  if (due) {
    const payload = updateOrderProgressPayload(order.id, due.progress, due.version, due.updatedAt);
    actions.push({
      action: Action.UPDATE_ORDER_PROGRESS,
      name: "UPDATE_ORDER_PROGRESS",
      ref: `${ref} ${order.progress} v${due.version}`,
      payload,
    });
  }

  return actions;
};
