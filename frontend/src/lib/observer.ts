// Observer API and the comparison with the registries. The comparison is not written
// here: it is the code of the Chainlink CRE workflow, imported as it is, so this page
// shows exactly the reports the workflow would send.
import { projectFund, projectOrderDetails, projectOrderIndex } from "../../../workflow-registry/lib/api";
import {
  UNREGISTERED_FUND,
  UNREGISTERED_ORDER,
  planFund,
  planOrder,
  type FundState,
  type OrderState,
} from "../../../workflow-registry/lib/plan";
import { shortText as toBytes32 } from "../../../workflow-registry/lib/encode";
import { OBSERVER } from "../config";
import {
  PROGRESS,
  getChains,
  getDeliveredReports,
  getFund,
  getFunds,
  getOrderStates,
  getOrdersOfFund,
  getStableCoins,
  type DeliveredReport,
  type OrderSummary,
} from "./registry";

const KEY_STORAGE = "observer-api-key";

/// The API key is typed by the user and kept in this browser only.
export const apiKey = {
  get: (): string => localStorage.getItem(KEY_STORAGE) ?? "",
  set: (value: string): void => {
    if (value === "") localStorage.removeItem(KEY_STORAGE);
    else localStorage.setItem(KEY_STORAGE, value);
  },
};

export class ObserverApiError extends Error {
  constructor(
    readonly status: number,
    path: string,
  ) {
    super(
      status === 401 || status === 403
        ? `A Observer API recusou a chave (HTTP ${status}).`
        : `Observer API GET ${path}: HTTP ${status}`,
    );
  }
}

/// GET of a path of the API, through the proxy. null for 404.
async function apiGet(path: string, key: string): Promise<Record<string, unknown> | null> {
  const response = await fetch(`${OBSERVER.proxyPath}${path}`, {
    headers: { "X-Observer-Id": OBSERVER.clientId, "X-Observer-Key": key, Accept: "application/json" },
  });
  // The API answers JSON even for its errors. Anything else came from the server of the
  // panel itself (its page, or its own 404): the proxy to the API is not configured there.
  if (!(response.headers.get("content-type") ?? "").includes("json")) {
    throw new Error(
      `Sem acesso à Observer API: o servidor do painel não está encaminhando as chamadas de ${OBSERVER.proxyPath}/ ` +
        `(HTTP ${response.status}). Veja a seção "Publicar" no README do frontend.`,
    );
  }
  if (response.status === 404) return null;
  if (!response.ok) throw new ObserverApiError(response.status, path);
  return (await response.json()) as Record<string, unknown>;
}

export type ApiFundEntry = {
  fundId: string;
  name: string;
  network: string;
};

// The API lists the funds created in the last 30 days unless told otherwise, and a fund
// must not leave the list as it gets older. The widest window the API accepts is about
// one year: a longer one is refused with HTTP 400.
const FUND_WINDOW_DAYS = 360;

/// Every fund the API key is authorized to see, in the order the API returns them.
/// The Chainlink CRE workflow registers the same list.
export async function listApiFunds(key: string): Promise<ApiFundEntry[]> {
  const funds: ApiFundEntry[] = [];
  const since = new Date(Date.now() - FUND_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  let cursor = "";

  // the API answers in pages: nextCursor is present while there is more
  for (let page = 0; page < 20; page++) {
    // the cursor already carries the filters of the first page: it is sent on its own
    const query = cursor === "" ? `from=${encodeURIComponent(since)}` : `cursor=${encodeURIComponent(cursor)}`;
    const reply = await apiGet(`/funds?${query}`, key);
    const items = Array.isArray(reply?.items) ? (reply.items as Record<string, unknown>[]) : [];
    for (const raw of items) {
      const fund = projectFund(raw);
      if (fund.fundId === "" || funds.some((f) => f.fundId === fund.fundId)) continue;
      funds.push({ fundId: fund.fundId, name: fund.name, network: fund.network });
    }
    cursor = typeof reply?.nextCursor === "string" ? reply.nextCursor : "";
    if (cursor === "" || items.length === 0) break;
  }
  return funds;
}

/// The funds the registries already have. Shown when the API cannot be read.
export async function listOnchainFunds(): Promise<ApiFundEntry[]> {
  const all = await getFunds();
  return all.map((f) => ({ fundId: f.fundId, name: f.name, network: f.chain.network }));
}

export type PendingReport = { name: string; ref: string };

/// A report already applied, with the transaction that delivered it.
export type DoneReport = { name: string; ref: string; timestamp: bigint; txHash: string };

export type FundSync = {
  fundId: string;
  name: string;
  inApi: boolean;
  /// Why the API could not be read. When set, only the onchain part is filled: the
  /// orders are the ones the registries have, and pending stays empty.
  apiError: string | null;
  registered: boolean;
  ordersInApi: number | null;
  ordersRegistered: number;
  /// Order transactions (transfer, lock, delivery) already recorded for the orders the
  /// API shows (or the registries have, when the API cannot be read). The creation transaction of the fund is not counted.
  txsRecorded: number;
  pending: PendingReport[];
  /// Reports of this fund the receiver already applied, oldest first.
  done: DoneReport[];
  problems: string[];
  /// Networks and stablecoins that are not registered yet and hold back reports of this
  /// fund. The workflow does not send those reports until an admin registers what is missing.
  blockers: Blocker[];
};

export type Blocker = {
  kind: "network" | "stablecoin";
  network: string;
  /// Stablecoin only: token address and symbol.
  token?: string;
  symbol?: string;
  /// What cannot be registered meanwhile: "o fundo", "3 ordens".
  blocks: string;
};

/// What the API has about a fund that the registries do not have yet.
export async function compareFund(fundId: string, key: string): Promise<FundSync> {
  // A failure of the API, or a missing key, must not hide what the registries have: it is kept apart
  type ApiReplies = { replies: readonly [Record<string, unknown> | null, Record<string, unknown> | null]; error: string | null };
  const api: Promise<ApiReplies> =
    key === ""
      ? Promise.resolve({ replies: [null, null], error: "Sem a chave da Observer API." })
      : Promise.all([apiGet(`/funds/${fundId}`, key), apiGet(`/funds/${fundId}/debenture-orders`, key)]).then(
          (replies) => ({ replies, error: null }),
          (err: unknown) => ({ replies: [null, null], error: err instanceof Error ? err.message : String(err) }),
        );
  const [{ replies, error: apiError }, onchainFund, chains, stableCoins, delivered] = await Promise.all([
    api,
    getFund(fundId),
    getChains(),
    getStableCoins(),
    getDeliveredReports(),
  ]);
  const [rawFund, rawOrders] = replies;

  const chainOf = (network: string) => chains.find((c) => c.network === network.trim().toLowerCase());

  const result: FundSync = {
    fundId,
    name: onchainFund?.name ?? "",
    inApi: rawFund !== null,
    apiError,
    registered: onchainFund !== null,
    ordersInApi: apiError === null ? 0 : null,
    ordersRegistered: 0,
    txsRecorded: 0,
    pending: [],
    done: [],
    problems: [],
    blockers: [],
  };

  // Reports about the fund itself
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  for (const report of delivered) {
    if (report.fundId === "" || !same(report.fundId, fundId)) continue;
    result.done.push({
      name: report.event === "FundRegisteredByWorkflow" ? "REGISTER_FUND" : "RECORD_FUND_CREATION_TX",
      ref: `fund ${report.fundId}`,
      timestamp: report.timestamp,
      txHash: report.txHash,
    });
  }

  if (apiError !== null) {
    const orders = onchainFund ? await getOrdersOfFund(fundId) : [];
    result.ordersRegistered = orders.filter((o) => o.registered).length;
    for (const o of orders) result.txsRecorded += o.roles.length;
    addOrderReports(result, delivered, orders);
    return result;
  }

  const fundState: FundState = onchainFund
    ? { registered: true, creationTxLinked: onchainFund.creationTxId !== 0n, stableSymbol: onchainFund.stable.symbol }
    : UNREGISTERED_FUND;

  let stableSymbol = fundState.stableSymbol;
  if (rawFund) {
    const fund = projectFund(rawFund);
    result.name ||= fund.name;
    stableSymbol ||= fund.stableSymbol;
    try {
      result.pending.push(...planFund(fund, fundState).map(({ name, ref }) => ({ name, ref })));
    } catch (err) {
      result.problems.push(`fundo: ${err instanceof Error ? err.message : String(err)}`);
    }

    // What registerFund needs: the network of the fund, and its stablecoin on that network
    if (!fundState.registered) {
      const chain = chainOf(fund.network);
      if (!chain) result.blockers.push({ kind: "network", network: fund.network, blocks: "o fundo" });
      const registered =
        chain !== undefined &&
        stableCoins.some((c) => c.chainId === chain.chainId && c.tokenAddress.toLowerCase() === fund.stableAddress.toLowerCase());
      if (!registered) {
        result.blockers.push({
          kind: "stablecoin",
          network: fund.network,
          token: fund.stableAddress,
          symbol: fund.stableSymbol,
          blocks: "o fundo",
        });
      }
    }
  }

  if (!rawOrders) return result;

  const index = projectOrderIndex(rawOrders);
  const details = projectOrderDetails(
    rawOrders,
    index.map((entry) => entry.id),
  );
  result.ordersInApi = details.length;
  if (details.length === 0) return result;

  const states = await getOrderStates(details.map((d) => d.id));
  const ordersByMissingNetwork = new Map<string, number>();

  details.forEach((order, i) => {
    const s = states[i];
    const state: OrderState = s.registered
      ? {
          registered: true,
          progress: s.progress,
          version: s.version,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
          roles: s.roles.map(toBytes32),
        }
      : UNREGISTERED_ORDER;
    if (s.registered) result.ordersRegistered++;
    result.txsRecorded += s.roles.length;

    try {
      const planned = planOrder(order, fundId, stableSymbol, state);
      result.pending.push(...planned.map(({ name, ref }) => ({ name, ref })));
    } catch (err) {
      result.problems.push(`ordem ${order.id}: ${err instanceof Error ? err.message : String(err)}`);
    }

    // What registerOrder needs: the destination network of the order
    const destination = order.intent.destinationNetwork;
    if (!s.registered && destination !== "" && !chainOf(destination)) {
      ordersByMissingNetwork.set(destination, (ordersByMissingNetwork.get(destination) ?? 0) + 1);
    }
  });

  addOrderReports(
    result,
    delivered,
    details.map((d, i) => ({ ...states[i], orderId: d.id })),
  );

  for (const [network, count] of ordersByMissingNetwork) {
    const fundBlocker = result.blockers.find((b) => b.kind === "network" && b.network === network);
    const orders = count === 1 ? "1 ordem" : `${count} ordens`;
    if (fundBlocker) fundBlocker.blocks += ` e ${orders}`;
    else result.blockers.push({ kind: "network", network, blocks: orders });
  }

  return result;
}

/// Adds the delivered reports of the given orders to result.done, oldest first.
function addOrderReports(result: FundSync, delivered: DeliveredReport[], orders: OrderSummary[]): void {
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  for (const report of delivered) {
    const order = report.orderId === "" ? undefined : orders.find((o) => same(o.orderId, report.orderId));
    if (!order) continue;
    const ref = `order ${order.orderId}`;
    if (report.event === "OrderRegisteredByWorkflow") {
      result.done.push({ name: "REGISTER_ORDER", ref, timestamp: report.timestamp, txHash: report.txHash });
    } else if (report.event === "OrderTxRecordedByWorkflow") {
      const role = order.roles[report.index] ?? `#${report.index}`;
      result.done.push({ name: "RECORD_ORDER_TX", ref: `${ref} ${role}`, timestamp: report.timestamp, txHash: report.txHash });
    } else if (report.event === "OrderProgressUpdatedByWorkflow") {
      result.done.push({
        name: "UPDATE_ORDER_PROGRESS",
        ref: `${ref} ${PROGRESS[report.progress] ?? report.progress} v${report.version}`,
        timestamp: report.timestamp,
        txHash: report.txHash,
      });
    }
  }
  result.done.sort((a, b) => Number(a.timestamp - b.timestamp));
}
