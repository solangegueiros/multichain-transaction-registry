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
import { getChains, getFund, getOrderStates, getStableCoins } from "./registry";

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

export type PendingReport = { name: string; ref: string };

export type FundSync = {
  fundId: string;
  name: string;
  inApi: boolean;
  registered: boolean;
  ordersInApi: number;
  ordersRegistered: number;
  /// Order transactions (transfer, lock, delivery): confirmed in the API, and how many of
  /// them are already recorded. The creation transaction of the fund is not counted.
  txsExpected: number;
  txsRecorded: number;
  pending: PendingReport[];
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
  const [rawFund, rawOrders, onchainFund, chains, stableCoins] = await Promise.all([
    apiGet(`/funds/${fundId}`, key),
    apiGet(`/funds/${fundId}/debenture-orders`, key),
    getFund(fundId),
    getChains(),
    getStableCoins(),
  ]);

  const chainOf = (network: string) => chains.find((c) => c.network === network.trim().toLowerCase());

  const result: FundSync = {
    fundId,
    name: onchainFund?.name ?? "",
    inApi: rawFund !== null,
    registered: onchainFund !== null,
    ordersInApi: 0,
    ordersRegistered: 0,
    txsExpected: 0,
    txsRecorded: 0,
    pending: [],
    problems: [],
    blockers: [],
  };

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

  for (const entry of index) {
    result.txsExpected += Number(entry.hasTransfer) + Number(entry.hasLock) + Number(entry.hasDelivery);
  }

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

  for (const [network, count] of ordersByMissingNetwork) {
    const fundBlocker = result.blockers.find((b) => b.kind === "network" && b.network === network);
    const orders = count === 1 ? "1 ordem" : `${count} ordens`;
    if (fundBlocker) fundBlocker.blocks += ` e ${orders}`;
    else result.blockers.push({ kind: "network", network, blocks: orders });
  }

  return result;
}
