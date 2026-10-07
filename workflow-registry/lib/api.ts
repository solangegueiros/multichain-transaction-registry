// Observer API responses, reduced to the fields the registries store.
// Pure module: no CRE SDK and no ABI code here, so it also runs outside the workflow.
//
// The projections run inside the HTTP callback, before the value enters consensus:
// only the projected fields count toward the consensus observation size limit.

type Raw = Record<string, unknown>;

/// GET /funds/{fundId}
export type ApiFund = {
  fundId: string;
  fidcId: string;
  name: string;
  network: string; // registry network id: "eip155:51"
  createdAt: string; // ISO 8601
  stableSymbol: string;
  stableAddress: string;
  contractAddress: string;
  creationIntentHash: string;
  creationTxHash: string;
};

/// One order of GET /funds/{fundId}/debenture-orders, just enough to tell whether
/// the order needs any onchain work.
export type OrderIndexEntry = {
  id: string;
  progress: string;
  version: string;
  updatedAt: string; // ISO 8601
  hasTransfer: boolean;
  hasLock: boolean;
  hasDelivery: boolean;
};

/// One side of an order: connectorResults.source or connectorResults.destination,
/// plus the disposition of the matching evidence.
export type OrderSide = {
  connectorId: string;
  network: string;
  status: string;
  standard: string;
  txHash: string;
  lockTxHash: string;
  blockHash: string;
  blockNumber: string;
  logIndex: string;
  assetId: string;
  amountUnits: string;
  from: string;
  to: string;
  disposition: string;
  // network-specific block (xrpl / stellar / rayls), flattened
  assetCode: string;
  assetIssuer: string;
  txType: string;
  ledgerHash: string;
  sequence: string;
  verificationScope: string;
};

export type OrderDetail = {
  id: string;
  intentHash: string;
  progress: string;
  version: string;
  createdAt: string;
  updatedAt: string;
  intent: {
    fundId: string;
    orderId: string;
    cashToken: string;
    validUntil: string;
    beneficiary: string;
    sourceAccount: string;
    sourceNetwork: string;
    destinationNetwork: string;
    sourceController: string;
  };
  source: OrderSide;
  destination: OrderSide;
};

/// Status of a connector result whose transaction is confirmed on its network.
export const VERIFIED = "VERIFIED";

// ============================================================
// HELPERS
// ============================================================

/// Text of a JSON value. null and undefined become "".
export const str = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return s === "None" || s === "null" ? "" : s;
};

const obj = (v: unknown): Raw => (v !== null && typeof v === "object" ? (v as Raw) : {});

const first = (...values: unknown[]): string => {
  for (const v of values) {
    const s = str(v);
    if (s !== "") return s;
  }
  return "";
};

/// Unix time, in seconds, of an ISO 8601 timestamp with an explicit offset
/// ("2026-09-12T19:38:29.274491+00:00"). The fraction of a second is dropped.
/// Written by hand because the fraction has six digits, which Date.parse does not
/// have to accept.
export const isoToUnixSeconds = (iso: string): bigint => {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/.exec(iso.trim());
  if (!m) throw new Error(`Invalid timestamp: "${iso}"`);
  const utc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
  let offsetMinutes = 0;
  if (m[7] !== "Z") {
    const sign = m[7][0] === "-" ? -1 : 1;
    offsetMinutes = sign * (Number(m[7].slice(1, 3)) * 60 + Number(m[7].slice(4, 6)));
  }
  return BigInt(utc / 1000 - offsetMinutes * 60);
};

// ============================================================
// PROJECTIONS
// ============================================================

export const projectFund = (raw: Raw): ApiFund => {
  const chainId = str(raw.chainId);
  return {
    fundId: str(raw.fundId),
    fidcId: str(raw.fidcId),
    name: str(raw.name),
    // every fund lives on an EVM chain: the API gives its numeric chain id
    network: chainId === "" ? "" : `eip155:${chainId}`,
    createdAt: str(raw.createdAt),
    stableSymbol: str(raw.stableSymbol),
    stableAddress: str(raw.stableAddress),
    contractAddress: str(raw.contractAddress),
    creationIntentHash: str(raw.creationIntentHash),
    creationTxHash: str(raw.creationTxHash),
  };
};

const items = (raw: Raw): Raw[] => (Array.isArray(raw.items) ? (raw.items as unknown[]).map(obj) : []);

const sideOf = (item: Raw, which: "source" | "destination"): Raw => obj(obj(item.connectorResults)[which]);

const confirmed = (side: Raw): boolean => str(side.status) === VERIFIED && str(side.txHash) !== "";

export const projectOrderIndex = (raw: Raw): OrderIndexEntry[] =>
  items(raw).map((item) => {
    const source = sideOf(item, "source");
    return {
      id: str(item.id),
      progress: str(item.progress),
      version: str(item.version),
      updatedAt: str(item.updatedAt),
      hasTransfer: confirmed(source),
      hasLock: str(source.lockTxHash) !== "",
      hasDelivery: confirmed(sideOf(item, "destination")),
    };
  });

const projectSide = (side: Raw, evidence: Raw): OrderSide => {
  // The network-specific block is named after the connector: xrpl, stellar, rayls
  const extra = obj(side[str(side.connectorId)] ?? side.xrpl ?? side.stellar ?? side.rayls);
  return {
    connectorId: str(side.connectorId),
    network: str(side.network),
    status: str(side.status),
    standard: str(side.standard),
    txHash: str(side.txHash),
    lockTxHash: str(side.lockTxHash),
    blockHash: str(side.blockHash),
    blockNumber: str(side.blockNumber),
    logIndex: str(side.logIndex),
    assetId: str(side.assetId),
    amountUnits: str(side.amountUnits),
    from: str(side.from),
    to: str(side.to),
    disposition: str(evidence.disposition),
    assetCode: first(extra.currency, extra.assetCode),
    assetIssuer: first(extra.issuer, extra.tokenContract),
    txType: first(extra.transactionType, extra.operationType),
    ledgerHash: str(extra.ledgerHash),
    sequence: str(extra.sequence),
    verificationScope: str(extra.verificationScope),
  };
};

/// Details of the orders whose id is in `ids`, in the order of the API response.
export const projectOrderDetails = (raw: Raw, ids: string[]): OrderDetail[] =>
  items(raw)
    .filter((item) => ids.includes(str(item.id)))
    .map((item) => {
      const intent = obj(item.intent);
      return {
        id: str(item.id),
        intentHash: str(item.intentHash),
        progress: str(item.progress),
        version: str(item.version),
        createdAt: str(item.createdAt),
        updatedAt: str(item.updatedAt),
        intent: {
          fundId: str(intent.fundId),
          orderId: str(intent.orderId),
          cashToken: str(intent.cashToken),
          validUntil: str(intent.validUntil),
          beneficiary: str(intent.beneficiary),
          sourceAccount: str(intent.sourceAccount),
          sourceNetwork: str(intent.sourceNetwork),
          destinationNetwork: str(intent.destinationNetwork),
          sourceController: str(intent.sourceController),
        },
        source: projectSide(sideOf(item, "source"), obj(item.sourceEvidence)),
        destination: projectSide(sideOf(item, "destination"), obj(item.destinationEvidence)),
      };
    });
