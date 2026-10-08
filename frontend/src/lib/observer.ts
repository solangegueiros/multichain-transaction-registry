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
import { getFund, getOrderStates } from "./registry";

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

export type PendingReport = { name: string; ref: string };

export type FundSync = {
  fundId: string;
  name: string;
  inApi: boolean;
  registered: boolean;
  ordersInApi: number;
  ordersRegistered: number;
  ordersInSync: number;
  pending: PendingReport[];
  problems: string[];
};

/// What the API has about a fund that the registries do not have yet.
export async function compareFund(fundId: string, key: string): Promise<FundSync> {
  const [rawFund, rawOrders, onchainFund] = await Promise.all([
    apiGet(`/funds/${fundId}`, key),
    apiGet(`/funds/${fundId}/debenture-orders`, key),
    getFund(fundId),
  ]);

  const result: FundSync = {
    fundId,
    name: onchainFund?.name ?? "",
    inApi: rawFund !== null,
    registered: onchainFund !== null,
    ordersInApi: 0,
    ordersRegistered: 0,
    ordersInSync: 0,
    pending: [],
    problems: [],
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

    try {
      const planned = planOrder(order, fundId, stableSymbol, state);
      if (planned.length === 0) result.ordersInSync++;
      result.pending.push(...planned.map(({ name, ref }) => ({ name, ref })));
    } catch (err) {
      result.problems.push(`ordem ${order.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  return result;
}
