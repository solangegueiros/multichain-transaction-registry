import { expect } from "chai";
import { readFileSync } from "node:fs";
import { ethers, networkHelpers, loadFixture, RELAYER_ROLE, OPERATOR_ROLE, Role, OrderProgress } from "./helpers/fundOrder.js";
import { CHAINS, SCHEMA_KEYS_BY_NETWORK } from "../scripts/lib/chains.js";

// End to end: the code of the CRE workflow (workflow-registry/lib) turns the Observer API
// samples of query-json/ into reports, and the reports are delivered to the real contracts.
// It proves that the ABI encoding of the workflow matches what MultiChainTxReceiver decodes,
// and that the extra args it sends are the ones scripts/register-chains.ts registers.
//
// The workflow has its own dependencies. Without them these tests are skipped. To install,
// from the repository root: bun install --cwd ./workflow-registry

const { time } = networkHelpers;

type Lib = typeof import("../../workflow-registry/lib/plan.js") &
  typeof import("../../workflow-registry/lib/api.js") &
  typeof import("../../workflow-registry/lib/encode.js");

let lib: Lib | undefined;
try {
  lib = {
    ...(await import("../../workflow-registry/lib/api.js")),
    ...(await import("../../workflow-registry/lib/encode.js")),
    ...(await import("../../workflow-registry/lib/plan.js")),
  };
} catch {
  lib = undefined;
}

// Stablecoins of query-json/fund*.json, the same of scripts/register-stablecoins.ts
const STABLECOINS = [
  { network: "eip155:51", tokenAddress: "0x243e98638D619eB6f10eaBbaCfC071f318D5e9d0", symbol: "BRL-CVM" },
  { network: "eip155:80002", tokenAddress: "0x25fC15B20F67049249FF70BB8A846e66BE07693C", symbol: "BRL1" },
  { network: "eip155:50", tokenAddress: "0x490590Eab907C4aF8aF845049FC7ac2F97e535F6", symbol: "BRL-CVM-DEV" },
];

const sample = (name: string) =>
  JSON.parse(readFileSync(new URL(`../../query-json/${name}.json`, import.meta.url), "utf8"));

/// Everything a deployment has before the workflow runs: the contracts, their roles,
/// the chains with their schema keys and the stablecoins. `other` plays the forwarder.
async function workflowFixture() {
  const [admin, , forwarder] = await ethers.getSigners();

  const txRegistry = await ethers.deployContract("MultiChainTxRegistry");
  const funds = await ethers.deployContract("FundRegistry", [await txRegistry.getAddress()]);
  const orders = await ethers.deployContract("OrderRegistry", [await txRegistry.getAddress(), await funds.getAddress()]);
  const receiver = await ethers.deployContract("MultiChainTxReceiver", [forwarder.address, await txRegistry.getAddress()]);

  await txRegistry.grantRole(RELAYER_ROLE, await funds.getAddress());
  await txRegistry.grantRole(RELAYER_ROLE, await orders.getAddress());
  await receiver.setFundRegistry(await funds.getAddress());
  await receiver.setOrderRegistry(await orders.getAddress());
  await funds.grantRole(OPERATOR_ROLE, await receiver.getAddress());
  await orders.grantRole(OPERATOR_ROLE, await receiver.getAddress());

  for (const c of CHAINS) {
    await txRegistry.registerChain(c.network, c.networkChainId, c.name, c.profileId, c.genesisHash);
  }
  for (const { network, keys } of SCHEMA_KEYS_BY_NETWORK) {
    for (const k of keys) {
      await txRegistry.registerSchemaKey(network, ethers.encodeBytes32String(k.key), k.valueType, k.description, false);
    }
  }
  await funds.grantRole(OPERATOR_ROLE, admin.address);
  for (const s of STABLECOINS) {
    await funds.registerStableCoin(await txRegistry.computeChainId(s.network), s.tokenAddress, s.symbol, 18);
  }

  const chainId = (await ethers.provider.getNetwork()).chainId;

  /// One pass of the workflow over a fund: reads the registries, plans, and delivers every
  /// report through the forwarder. Returns the names of the reports it delivered.
  async function sync(fundSample: string, ordersSample: string): Promise<string[]> {
    const l = lib!;
    const fund = l.projectFund(sample(fundSample));
    const rawOrders = sample(ordersSample);
    const index = l.projectOrderIndex(rawOrders);
    const details = l.projectOrderDetails(rawOrders, index.map((e) => e.id));

    const onchainFund = (await funds.listFunds(0, 0)).find((f) => f.fundKey === l.keyOf(fund.fundId));
    const fundState = onchainFund
      ? { registered: true, creationTxLinked: onchainFund.creationTxId !== 0n, stableSymbol: onchainFund.stable.symbol }
      : l.UNREGISTERED_FUND;

    const actions = [...l.planFund(fund, fundState)];
    // The one read the workflow makes for the orders of a fund
    const onchain = await orders.getOrderSyncStates(details.map((d) => d.id));

    for (const [i, order] of details.entries()) {
      const o = onchain[i];
      const state = o.registered
        ? {
            registered: true,
            progress: Number(o.progress),
            version: Number(o.version),
            createdAt: o.createdAt,
            updatedAt: o.updatedAt,
            roles: o.roles.map((r) => r as `0x${string}`),
          }
        : l.UNREGISTERED_ORDER;
      const planned = l.planOrder(order, fund.fundId, fundState.stableSymbol || fund.stableSymbol, state);

      // The index entry alone must tell whether the order has reports due
      const entry = index.find((e) => e.id === order.id)!;
      expect(l.needsWork(entry, state), `needsWork of order ${order.id}`).to.equal(planned.length !== 0);

      actions.push(...planned);
    }

    /// What the workflow reads after a write to confirm that the report was applied
    async function applied(expect: (typeof actions)[number]["expect"]): Promise<boolean> {
      if ("fundId" in expect) {
        const f = (await funds.listFunds(0, 0)).find((x) => x.fundKey === l.keyOf(expect.fundId));
        return l.fundApplied(
          expect,
          f ? { registered: true, creationTxLinked: f.creationTxId !== 0n, stableSymbol: f.stable.symbol } : l.UNREGISTERED_FUND,
        );
      }
      const [o] = await orders.getOrderSyncStates([expect.orderId]);
      return l.orderApplied(
        expect,
        o.registered
          ? {
              registered: true,
              progress: Number(o.progress),
              version: Number(o.version),
              createdAt: o.createdAt,
              updatedAt: o.updatedAt,
              roles: o.roles.map((r) => r as `0x${string}`),
            }
          : l.UNREGISTERED_ORDER,
      );
    }

    for (const action of actions) {
      const label = `${action.name} ${action.ref}`;
      // the check must tell a report that was not applied from one that was
      expect(await applied(action.expect), `${label} before the report`).to.equal(false);
      const report = l.encodeReport(chainId, BigInt(await time.latest()), action.action, action.payload);
      await receiver.connect(forwarder).onReport("0x", report);
      expect(await applied(action.expect), `${label} after the report`).to.equal(true);
    }
    return actions.map((a) => `${a.name} ${a.ref}`);
  }

  return { txRegistry, funds, orders, receiver, sync };
}

describe("CRE workflow: reports built from the Observer API samples", function () {
  before(function () {
    if (!lib) this.skip();
  });

  it("registers the fund, its orders, their transactions and their progress", async function () {
    const { txRegistry, funds, orders, sync } = await loadFixture(workflowFixture);

    const sent = await sync("fund", "orders");
    expect(sent[0]).to.equal("REGISTER_FUND fund be6f2e8a-5474-43c7-a692-7918c37e3f42");

    // fund.json, with its creation transaction registered and linked
    const fund = await funds.getFund("be6f2e8a-5474-43c7-a692-7918c37e3f42");
    expect(fund.fidcId).to.equal(2n);
    expect(fund.chain.network).to.equal("eip155:51");
    expect(fund.stable.symbol).to.equal("BRL-CVM");
    expect(fund.createdAt).to.equal(1789241909n); // 2026-09-12T19:38:29Z
    expect(fund.creationTxId).to.not.equal(0n);
    expect((await txRegistry.getTx(fund.creationTxId)).txHash).to.equal(
      "0x14621df8a3245e876448ce96d475988f44f7dca038a1bc666ed189a0f204682c",
    );

    // every order of orders.json
    const registered = await orders.getOrdersByFund("be6f2e8a-5474-43c7-a692-7918c37e3f42");
    expect(registered.length).to.equal(sample("orders").items.length);

    // the order with the three transactions
    const orderId = "8fdac770-7ca3-4a1f-a283-33efa75c96ef";
    const order = await orders.getOrder(orderId);
    expect(order.intentHash).to.equal("0x61179240cd0bc32730b1d3f9ce88c22e6dbe2b82c5098762f5fd4f5307b1f794");
    expect(order.progress).to.equal(OrderProgress.ACQUIRED_WITH_LOCK);
    expect(order.version).to.equal(3n);
    expect(order.createdAt).to.equal(1789309798n); // 2026-09-13T14:29:58Z
    expect(order.updatedAt).to.equal(1789310957n); // 2026-09-13T14:49:17Z

    const txs = await orders.getOrderTxs(orderId);
    expect(txs.map((t) => t.role)).to.deep.equal([Role.TRANSFER, Role.LOCK, Role.DELIVERY]);
    expect(txs.map((t) => ethers.decodeBytes32String(t.disposition))).to.deep.equal(["LOCKED", "", "DELIVERED"]);

    const transfer = await txRegistry.getTx(txs[0].txId);
    expect(transfer.chainId).to.equal(await txRegistry.computeChainId("eip155:51"));
    expect(transfer.amount).to.equal(100n * 10n ** 18n);
    expect(transfer.assetCode).to.equal("BRL-CVM");
    expect(transfer.to).to.equal("0xB4F6aAd0196D058353835c68B89F1F06c16490EF");
    expect(transfer.blockNumber).to.equal(86721398n);
    const transferArgs = await txRegistry.getExtraArgs(txs[0].txId);
    expect(transferArgs.map((a) => ethers.decodeBytes32String(a.key))).to.deep.equal(["blockHash", "logIndex"]);

    const lock = await txRegistry.getTx(txs[1].txId);
    expect(lock.txHash).to.equal("0x7b61fdd2d9246743e19090d184bc970b5b849e6b8c4171ac746e05448aa573a2");
    expect(lock.to).to.equal("0xB4F6aAd0196D058353835c68B89F1F06c16490EF");

    const delivery = await txRegistry.getTx(txs[2].txId);
    expect(delivery.chainId).to.equal(await txRegistry.computeChainId("xrpl:testnet"));
    expect(delivery.amount).to.equal(100n);
    expect(delivery.assetCode).to.equal("CVD");
    expect(delivery.assetIssuer).to.equal("r9aceEB7Qy5JrHtYt2KGhF4KVMgEGjoY2U");
    expect(delivery.txType).to.equal("Payment");
    const deliveryArgs = await txRegistry.getExtraArgs(txs[2].txId);
    expect(deliveryArgs.map((a) => ethers.decodeBytes32String(a.key))).to.deep.equal(["ledgerHash", "sequence"]);
    expect(ethers.AbiCoder.defaultAbiCoder().decode(["uint32"], deliveryArgs[1].value)[0]).to.equal(20725947n);
  });

  it("sends nothing on a second pass over the same data", async function () {
    const { sync } = await loadFixture(workflowFixture);

    expect(await sync("fund", "orders")).to.not.be.empty;
    expect(await sync("fund", "orders")).to.deep.equal([]);
  });

  for (const [fundSample, ordersSample, what] of [
    ["fund2", "orders2", "Stellar and XRPL deliveries"],
    ["fund3", "orders3", "a Polygon fund with Rayls deliveries"],
    ["fund4", "orders4", "an XDC mainnet fund"],
  ]) {
    it(`handles ${fundSample}.json and ${ordersSample}.json: ${what}`, async function () {
      const { orders, sync } = await loadFixture(workflowFixture);
      const raw = sample(ordersSample);

      const sent = await sync(fundSample, ordersSample);
      expect(sent.filter((s) => s.startsWith("REGISTER_ORDER")).length).to.equal(raw.items.length);
      expect(await sync(fundSample, ordersSample)).to.deep.equal([]);

      // each order has the progress and the version the API reports
      for (const item of raw.items) {
        const order = await orders.getOrder(item.id);
        expect(order.version, `version of ${item.id}`).to.equal(BigInt(item.version));
        expect(order.progress, `progress of ${item.id}`).to.equal(BigInt(lib!.ORDER_PROGRESS[item.progress]));
      }
    });
  }

  it("builds the keys the contracts build", async function () {
    const { funds } = await loadFixture(workflowFixture);

    for (const id of ["be6f2e8a-5474-43c7-a692-7918c37e3f42", " EIP155:51 ", "XRPL:Testnet"]) {
      expect(lib!.keyOf(id)).to.equal(await funds.keyOf(id));
    }
  });
});
