// Keeps the registries in step with the Observer API.
//
// On each cron tick, for each configured fund:
//   1. reads the fund and its orders from the Observer API;
//   2. reads from FundRegistry and OrderRegistry what is already registered;
//   3. sends one report to MultiChainTxReceiver for each thing that is missing:
//      the fund, its orders, the transactions of each order and the order progress.
//
// A run does a limited amount of work (see the limits below and in the config).
// What does not fit is picked up by the next runs: nothing is remembered between
// runs, the registries are the only state.
import {
  CronCapability,
  EVMClient,
  HTTPClient,
  LATEST_BLOCK_NUMBER,
  TxStatus,
  bytesToHex,
  consensusIdenticalAggregation,
  encodeCallMsg,
  getNetwork,
  handler,
  json,
  ok,
  prepareReportRequest,
  type HTTPSendRequester,
  type Runtime,
} from "@chainlink/cre-sdk";
import {
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  keccak256,
  toHex,
  zeroAddress,
  type Abi,
  type Hex,
} from "viem";
import { z } from "zod";
import { FUND_REGISTRY_ABI, ORDER_REGISTRY_ABI, TX_REGISTRY_ABI } from "./lib/abi.js";
import {
  projectFund,
  projectOrderDetails,
  projectOrderIndex,
  type ApiFund,
  type OrderDetail,
  type OrderIndexEntry,
} from "./lib/api.js";
import { ZERO_BYTES32, encodeReport, keyOf } from "./lib/encode.js";
import {
  UNREGISTERED_FUND,
  UNREGISTERED_ORDER,
  needsWork,
  planFund,
  planOrder,
  type FundState,
  type OrderState,
  type PlannedAction,
} from "./lib/plan.js";

// ============================================================
// CONFIG
// ============================================================

const contractAddress = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "must be a contract address (fill it with: npm run workflow:sync-config)")
  .refine((a) => !/^0x0{40}$/.test(a), "must not be the zero address");

const shared = {
  schedule: z.string().regex(/^(\S+\s+){5}\S+$/, "must be a six-field cron expression"),
  apiBaseUrl: z.string().regex(/^https?:\/\/\S+[^\/\s]$/, "must be a URL without a trailing slash"), // Observer API
  apiClientId: z.string().min(1), // X-Observer-Id header
  fundIds: z.array(z.string().min(1)).min(1).max(5),
  maxOrdersPerRun: z.number().int().min(1).max(10), // orders that get reports in one run, per fund
};

/// Two closed variants. "local-simulation" only reads the API and shows the reports it
/// would send; it has no contract address and cannot write. "production" reads the
/// registries and writes.
export const configSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("local-simulation"), ...shared }).strict(),
  z
    .object({
      mode: z.literal("production"),
      ...shared,
      chainSelectorName: z.string().min(1), // "ethereum-testnet-sepolia"
      targetChainId: z.string().regex(/^[1-9]\d*$/), // EVM chain id of that chain: "11155111"
      receiverAddress: contractAddress, // MultiChainTxReceiver
      txRegistryAddress: contractAddress, // MultiChainTxRegistry
      fundRegistryAddress: contractAddress,
      orderRegistryAddress: contractAddress,
      gasLimit: z.string().regex(/^[1-9]\d*$/), // gas limit of each report transaction
      maxWritesPerRun: z.number().int().min(1).max(10), // reports sent in one run
    })
    .strict(),
]);

export type Config = z.infer<typeof configSchema>;
type ProductionConfig = Extract<Config, { mode: "production" }>;

// CRE service quotas per execution (https://docs.chain.link/cre/service-quotas)
const MAX_HTTP_CALLS = 15;
const MAX_CHAIN_READS = 15;

/// Orders asked in one getOrderSyncStates call. An EVM read request is limited to
/// 5 KB, and each order id takes 128 bytes of it.
const ORDERS_PER_READ = 30;

/// Secret with the Observer API key (X-Observer-Key header). See secrets.yaml.
const API_KEY_SECRET = "OBSERVER_API_KEY";

// ============================================================
// RESULT
// ============================================================

type Summary = {
  mode: Config["mode"];
  funds: number;
  ordersSeen: number;
  planned: number; // reports due, found in this run
  written: number; // reports delivered
  notBroadcast: number; // reports built in a simulation without --broadcast: nothing was sent
  deferred: number; // reports left for the next runs
  sent: string[];
  errors: string[];
};

/// Text of an error. An error raised inside a capability callback comes back from the
/// SDK with its error code in front, as "[2]Unknown: ": the code says nothing about the
/// cause, so it is dropped.
const message = (err: unknown): string =>
  (err instanceof Error ? err.message : String(err)).replace(/^\[\d+\]\w+: /, "");

/// Same list, starting at a position that changes from run to run, so that work
/// that never succeeds cannot keep the rest of the list from being reached.
const rotate = <T>(list: T[], seed: bigint): T[] => {
  if (list.length < 2) return list;
  const start = Number(seed % BigInt(list.length));
  return [...list.slice(start), ...list.slice(0, start)];
};

// ============================================================
// OBSERVER API
// ============================================================

type ApiResult<T> = { found: false } | { found: true; body: T };

class ObserverApi {
  calls = 0;
  private readonly http = new HTTPClient();

  constructor(
    private readonly runtime: Runtime<Config>,
    private readonly apiKey: string,
  ) {}

  get remaining(): number {
    return MAX_HTTP_CALLS - this.calls;
  }

  /// GET of a path of the API. `project` runs in each node, before consensus: the
  /// nodes agree on the projected value only, serialized to a string.
  private get<T>(path: string, project: (raw: Record<string, unknown>) => T): ApiResult<T> {
    if (this.remaining <= 0) throw new Error("HTTP call limit of the run reached");
    this.calls++;

    const { apiBaseUrl, apiClientId } = this.runtime.config;
    const url = `${apiBaseUrl}${path}`;
    const apiKey = this.apiKey;

    const raw = this.http
      .sendRequest(
        this.runtime,
        (sender: HTTPSendRequester): string => {
          const response = sender
            .sendRequest({
              url,
              method: "GET",
              headers: { "X-Observer-Id": apiClientId, "X-Observer-Key": apiKey, Accept: "application/json" },
            })
            .result();
          if (response.statusCode === 404) return JSON.stringify({ found: false });
          if (response.statusCode === 401 || response.statusCode === 403) {
            throw new Error(
              `Observer API GET ${path}: HTTP ${response.statusCode}, the API refused the credentials ` +
                "(check API_OBSERVER_KEY in .env and apiClientId in the config)",
            );
          }
          if (!ok(response)) throw new Error(`Observer API GET ${path}: HTTP ${response.statusCode}`);
          return JSON.stringify({ found: true, body: project(json(response) as Record<string, unknown>) });
        },
        consensusIdenticalAggregation<string>(),
      )()
      .result();

    return JSON.parse(raw) as ApiResult<T>;
  }

  fund(fundId: string): ApiResult<ApiFund> {
    return this.get(`/funds/${fundId}`, projectFund);
  }

  orderIndex(fundId: string): ApiResult<OrderIndexEntry[]> {
    return this.get(`/funds/${fundId}/debenture-orders`, projectOrderIndex);
  }

  orderDetails(fundId: string, ids: string[]): ApiResult<OrderDetail[]> {
    return this.get(`/funds/${fundId}/debenture-orders`, (raw) => projectOrderDetails(raw, ids));
  }
}

// ============================================================
// REGISTRIES (production only)
// ============================================================

class Registries {
  reads = 0;
  writes = 0;
  private readonly evm: EVMClient;
  private readonly registeredNetworks = new Map<string, boolean>();

  constructor(
    private readonly runtime: Runtime<Config>,
    private readonly config: ProductionConfig,
  ) {
    const network = getNetwork({ chainFamily: "evm", chainSelectorName: config.chainSelectorName });
    if (!network) throw new Error(`Unknown chainSelectorName: ${config.chainSelectorName}`);
    this.evm = new EVMClient(network.chainSelector.selector);
  }

  get readsLeft(): number {
    return MAX_CHAIN_READS - this.reads;
  }

  get writesLeft(): number {
    return this.config.maxWritesPerRun - this.writes;
  }

  /// View call at the latest block. Finalized would be safer against reorgs, but it
  /// lags minutes behind: a report sent by the previous run would not be seen yet and
  /// would be sent again. A repeated report is rejected by the registries anyway.
  private read(to: string, abi: Abi, functionName: string, args: unknown[]): unknown {
    if (this.readsLeft <= 0) throw new Error("Chain read limit of the run reached");
    this.reads++;

    const reply = this.evm
      .callContract(this.runtime, {
        call: encodeCallMsg({
          from: zeroAddress,
          to: getAddress(to),
          data: encodeFunctionData({ abi, functionName, args }),
        }),
        blockNumber: LATEST_BLOCK_NUMBER,
      })
      .result();

    return decodeFunctionResult({ abi, functionName, data: bytesToHex(reply.data) });
  }

  /// State of every configured fund, from one call.
  fundStates(fundIds: string[]): Map<string, FundState> {
    const funds = this.read(this.config.fundRegistryAddress, FUND_REGISTRY_ABI, "listFunds", [0n, 0n]) as {
      fundKey: Hex;
      creationTxId: bigint;
      stable: { symbol: string };
    }[];

    const states = new Map<string, FundState>();
    for (const fundId of fundIds) {
      const fund = funds.find((f) => f.fundKey === keyOf(fundId));
      states.set(
        fundId,
        fund
          ? { registered: true, creationTxLinked: fund.creationTxId !== 0n, stableSymbol: fund.stable.symbol }
          : UNREGISTERED_FUND,
      );
    }
    return states;
  }

  networkRegistered(network: string): boolean {
    const known = this.registeredNetworks.get(network);
    if (known !== undefined) return known;

    const chain = this.read(this.config.txRegistryAddress, TX_REGISTRY_ABI, "chains", [keyOf(network)]) as readonly [Hex];
    const registered = chain[0] !== ZERO_BYTES32;
    this.registeredNetworks.set(network, registered);
    return registered;
  }

  stableCoinRegistered(network: string, token: string): boolean {
    const coins = this.read(this.config.fundRegistryAddress, FUND_REGISTRY_ABI, "listStableCoins", []) as {
      chainId: Hex;
      tokenAddress: Hex;
    }[];
    const chainId = keyOf(network);
    return coins.some((c) => c.chainId === chainId && c.tokenAddress.toLowerCase() === token.toLowerCase());
  }

  /// Calls orderStates needs for this many orders.
  static orderStateReads(orders: number): number {
    return Math.ceil(orders / ORDERS_PER_READ);
  }

  /// State of every order asked, registered or not: one call for each ORDERS_PER_READ orders.
  orderStates(orderIds: string[]): Map<string, OrderState> {
    const states = new Map<string, OrderState>();
    for (let from = 0; from < orderIds.length; from += ORDERS_PER_READ) {
      const ids = orderIds.slice(from, from + ORDERS_PER_READ);
      const reply = this.read(this.config.orderRegistryAddress, ORDER_REGISTRY_ABI, "getOrderSyncStates", [ids]) as {
        registered: boolean;
        progress: number;
        version: number;
        createdAt: bigint;
        updatedAt: bigint;
        roles: readonly Hex[];
      }[];
      ids.forEach((id, i) => {
        const s = reply[i];
        states.set(
          id,
          s.registered
            ? {
                registered: true,
                progress: Number(s.progress),
                version: Number(s.version),
                createdAt: s.createdAt,
                updatedAt: s.updatedAt,
                roles: [...s.roles],
              }
            : UNREGISTERED_ORDER,
        );
      });
    }
    return states;
  }

  /// Sends one report to MultiChainTxReceiver. Returns the transaction hash, or null when
  /// the report was built but not sent, which is what a simulation without --broadcast
  /// does. Throws when the transaction fails or when the receiver rejects the report.
  write(action: PlannedAction, timestamp: bigint): string | null {
    if (this.writesLeft <= 0) throw new Error("Write limit of the run reached");
    this.writes++;

    const encoded = encodeReport(BigInt(this.config.targetChainId), timestamp, action.action, action.payload);
    const report = this.runtime.report(prepareReportRequest(encoded)).result();

    const result = this.evm
      .writeReport(this.runtime, {
        receiver: this.config.receiverAddress,
        report,
        gasConfig: { gasLimit: this.config.gasLimit },
      })
      .result();

    if (result.txStatus !== TxStatus.SUCCESS) {
      throw new Error(result.errorMessage ?? `write status ${result.txStatus}`);
    }
    // A simulation without --broadcast reports success with no transaction: never
    // take this for a delivery
    if (!result.txHash || result.txHash.length === 0) return null;

    const txHash = bytesToHex(result.txHash);
    // The forwarder transaction succeeds even when the receiver reverts: the revert is
    // only visible here. 1 is RECEIVER_CONTRACT_EXECUTION_STATUS_REVERTED.
    if (Number(result.receiverContractExecutionStatus ?? 0) === 1) {
      throw new Error(`receiver rejected the report (tx ${txHash})`);
    }
    return txHash;
  }
}

// ============================================================
// RUN
// ============================================================

class Run {
  readonly summary: Summary;
  private readonly timestamp: bigint; // DON time, in seconds
  private readonly seed: bigint;

  constructor(
    private readonly runtime: Runtime<Config>,
    private readonly api: ObserverApi,
    private readonly registries: Registries | null,
  ) {
    const config = runtime.config;
    this.summary = { mode: config.mode, funds: 0, ordersSeen: 0, planned: 0, written: 0, notBroadcast: 0, deferred: 0, sent: [], errors: [] };
    this.timestamp = BigInt(Math.floor(runtime.now().getTime() / 1000));
    this.seed = BigInt(keccak256(toHex(this.timestamp / 60n)));
  }

  private error(ref: string, err: unknown): void {
    const text = `${ref}: ${message(err)}`.slice(0, 300);
    this.runtime.log(`ERROR ${text}`);
    this.summary.errors.push(text);
  }

  private defer(label: string, reason: string): false {
    this.runtime.log(`deferred ${label}: ${reason}`);
    this.summary.deferred++;
    return false;
  }

  /// Sends the action, or only shows it in local-simulation mode.
  /// Returns false when it was neither sent nor shown: the caller stops there.
  private send(action: PlannedAction): boolean {
    this.summary.planned++;
    const label = `${action.name} ${action.ref}`;

    if (!this.registries) {
      const bytes = (encodeReport(1n, this.timestamp, action.action, action.payload).length - 2) / 2;
      this.runtime.log(`[local-simulation] would send ${label} (report of ${bytes} bytes)`);
      this.summary.sent.push(label);
      return true;
    }

    if (this.registries.writesLeft <= 0) return this.defer(label, "write limit of the run reached");

    try {
      if (action.requiresNetwork !== undefined) {
        if (this.registries.readsLeft <= 0) return this.defer(label, "chain read limit of the run reached");
        if (!this.registries.networkRegistered(action.requiresNetwork)) {
          throw new Error(`network ${action.requiresNetwork} is not registered in MultiChainTxRegistry`);
        }
      }
      const txHash = this.registries.write(action, this.timestamp);
      if (txHash === null) {
        // The run goes on as if the report had been delivered, to show what would follow it
        this.runtime.log(`[no --broadcast] would send ${label} (not sent)`);
        this.summary.notBroadcast++;
        return true;
      }
      this.runtime.log(`sent ${label} tx=${txHash}`);
      this.summary.sent.push(label);
      this.summary.written++;
      return true;
    } catch (err) {
      this.error(label, err);
      return false;
    }
  }

  /// Makes sure the fund is registered. Returns its state, or null when the orders
  /// of the fund cannot be processed in this run.
  private syncFund(fundId: string, state: FundState): FundState | null {
    const reply = this.api.fund(fundId);
    if (!reply.found) {
      if (!state.registered && this.registries) {
        this.error(`fund ${fundId}`, "not found in the Observer API and not registered");
        return null;
      }
      return state;
    }
    const fund = reply.body;

    let actions: PlannedAction[];
    try {
      actions = planFund(fund, state);
    } catch (err) {
      this.error(`fund ${fundId}`, err);
      return state.registered || !this.registries ? state : null;
    }

    // registerFund reverts without its stablecoin: check before spending a transaction
    if (this.registries && !state.registered) {
      if (this.registries.readsLeft < 2) return null;
      if (!this.registries.stableCoinRegistered(fund.network, fund.stableAddress)) {
        this.error(`fund ${fundId}`, `stablecoin ${fund.stableAddress} on ${fund.network} is not registered in FundRegistry`);
        return null;
      }
    }

    for (const action of actions) {
      if (!this.send(action) && !state.registered && this.registries) return null;
    }

    return {
      registered: true,
      creationTxLinked: state.creationTxLinked || fund.creationTxHash !== "",
      stableSymbol: state.stableSymbol !== "" ? state.stableSymbol : fund.stableSymbol,
    };
  }

  private syncOrders(fundId: string, fund: FundState, fundWasRegistered: boolean): void {
    const config = this.runtime.config;

    const reply = this.api.orderIndex(fundId);
    if (!reply.found) {
      this.runtime.log(`fund ${fundId}: no orders in the Observer API`);
      return;
    }
    const index = reply.body;
    this.summary.ordersSeen += index.length;

    // Orders that need reports, with what the registry has about each
    const selected = new Map<string, OrderState>();

    if (!this.registries) {
      for (const entry of index.slice(0, config.maxOrdersPerRun)) selected.set(entry.id, UNREGISTERED_ORDER);
    } else {
      // A fund registered by this very run has no orders yet: nothing to read
      let states = new Map<string, OrderState>();
      if (fundWasRegistered && index.length !== 0) {
        // one read is kept for a network check
        if (this.registries.readsLeft < Registries.orderStateReads(index.length) + 1) {
          this.runtime.log(`fund ${fundId}: left for the next run, chain read limit of the run reached`);
          return;
        }
        states = this.registries.orderStates(index.map((entry) => entry.id));
      }
      // Rotated, so that an order whose reports always fail does not keep the others waiting
      for (const entry of rotate(index, this.seed)) {
        if (selected.size >= config.maxOrdersPerRun) break;
        const state = states.get(entry.id) ?? UNREGISTERED_ORDER;
        if (needsWork(entry, state)) selected.set(entry.id, state);
      }
    }

    this.runtime.log(`fund ${fundId}: ${index.length} order(s) in the API, ${selected.size} with reports due`);
    if (selected.size === 0) return;
    this.runtime.log(`reports due for order(s): ${[...selected.keys()].join(", ")}`);

    const details = this.api.orderDetails(fundId, [...selected.keys()]);
    if (!details.found) return;

    for (const order of details.body) {
      const state = selected.get(order.id);
      if (!state) continue;
      try {
        const actions = planOrder(order, fundId, fund.stableSymbol, state);
        for (let i = 0; i < actions.length; i++) {
          if (this.send(actions[i])) continue;
          // the remaining reports of the order depend on this one
          const rest = actions.length - i - 1;
          this.summary.planned += rest;
          this.summary.deferred += rest;
          break;
        }
      } catch (err) {
        this.error(`order ${order.id}`, err);
      }
    }
  }

  execute(): Summary {
    const { fundIds } = this.runtime.config;
    const states = this.registries ? this.registries.fundStates(fundIds) : new Map<string, FundState>();
    const funds = this.registries ? rotate(fundIds, this.seed) : fundIds;

    for (const fundId of funds) {
      // a fund takes up to three API calls: the fund, the order index and the order details
      if (this.api.remaining < 3) break;
      if (this.registries && this.registries.writesLeft <= 0) break;

      this.summary.funds++;
      try {
        const before = states.get(fundId) ?? UNREGISTERED_FUND;
        const fund = this.syncFund(fundId, before);
        if (fund) this.syncOrders(fundId, fund, before.registered);
      } catch (err) {
        this.error(`fund ${fundId}`, err);
      }
    }

    const s = this.summary;
    this.runtime.log(
      `done: ${s.funds} fund(s), ${s.ordersSeen} order(s), ${s.planned} report(s) due, ` +
        `${s.written} sent, ${s.notBroadcast > 0 ? `${s.notBroadcast} not sent (simulation without --broadcast), ` : ""}` +
        `${s.deferred} deferred, ${s.errors.length} error(s); ` +
        `${this.api.calls} API call(s), ${this.registries ? this.registries.reads : 0} chain read(s)`,
    );
    return s;
  }
}

// ============================================================
// HANDLER
// ============================================================

export const onCronTrigger = (runtime: Runtime<Config>): string => {
  const config = runtime.config;

  // Both modes read the Observer API the same way
  const apiKey = runtime.getSecret({ id: API_KEY_SECRET }).result().value;
  const api = new ObserverApi(runtime, apiKey);

  // local-simulation stops short of anything that touches a chain: no registry
  // client is built, so the run can only show the reports it would send
  const registries = config.mode === "production" ? new Registries(runtime, config) : null;

  return JSON.stringify(new Run(runtime, api, registries).execute());
};

export const initWorkflow = (config: Config) => [
  handler(new CronCapability().trigger({ schedule: config.schedule }), onCronTrigger),
];
