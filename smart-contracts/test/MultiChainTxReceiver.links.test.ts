import { expect } from "chai";
import {
  ethers,
  networkHelpers,
  loadFixture,
  abi,
  ADMIN_ROLE,
  RELAYER_ROLE,
  OPERATOR_ROLE,
  TxStatus,
  OrderProgress,
  Disposition,
  Role,
  keyOf,
  XDC_CHAIN,
  XRPL_CHAIN,
  STELLAR_CHAIN,
  STABLE,
  FUND,
  FUND2,
  FUND_CREATION_TX,
  ORDER,
  INTENT,
  ORDER2,
  INTENT2,
  DELIVERY2_INFO,
  DESTINATION2_TX,
  TRANSFER_INFO,
  SOURCE_TX,
  LOCK_INFO,
  LOCK_TX,
  DELIVERY_INFO,
  DESTINATION_TX,
  orderFixture,
} from "./helpers/fundOrder.js";

// Reports that write in OrderRegistry and FundRegistry: register a fund or an order, update
// the progress of an order, and link a transaction to an order or to a fund.
// The reports that write only in MultiChainTxRegistry are in MultiChainTxReceiver.test.ts.

const { time } = networkHelpers;

enum Action {
  REGISTER_TX = 0,
  UPDATE_TX_STATUS = 1,
  RECORD_ORDER_TX = 2,
  RECORD_FUND_CREATION_TX = 3,
  REGISTER_FUND = 4,
  REGISTER_ORDER = 5,
  UPDATE_ORDER_PROGRESS = 6,
}

// ============================================================
// REPORT ENCODING (what a CRE workflow does before runtime.report)
// ============================================================

const TX_INPUT_TYPE =
  "tuple(uint8 status, string txHash, string from, string to, uint256 amount, string assetCode, " +
  "string assetIssuer, string txType, bytes data, string dataType, uint256 blockNumber, uint256 timestamp)";
const EXTRA_ARG_TYPE = "tuple(bytes32 key, bytes value)";
const ORDER_TX_INPUT_TYPE = "tuple(string connectorId, string standard, bytes32 disposition)";
const FUND_INPUT_TYPE =
  "tuple(string fundId, uint256 fidcId, string name, bytes32 chainId, address contractAddress, " +
  "address stableAddress, bytes32 creationIntentHash, uint256 createdAt)";
const ORDER_INTENT_TYPE =
  "tuple(string orderId, address cashToken, uint64 validUntil, address beneficiary, bytes32 sourceChainId, " +
  "address sourceAccount, bytes32 destinationChainId)";
const REPORT_TYPE = "tuple(uint256 targetChainId, uint64 timestamp, uint8 action, bytes payload)";

type ExtraArg = { key: string; value: string };
type TxInput = typeof SOURCE_TX;
type OrderTxInput = typeof TRANSFER_INFO;

function encodeReport(targetChainId: bigint, timestamp: bigint, action: number, payload: string): string {
  return abi.encode([REPORT_TYPE], [{ targetChainId, timestamp, action, payload }]);
}

function orderTxPayload(orderId: string, role: string, input: OrderTxInput, tx: TxInput, extraArgs: ExtraArg[] = []): string {
  return abi.encode(
    ["string", "bytes32", ORDER_TX_INPUT_TYPE, TX_INPUT_TYPE, `${EXTRA_ARG_TYPE}[]`],
    [orderId, role, input, tx, extraArgs],
  );
}

function fundCreationPayload(fundId: string, tx: TxInput, extraArgs: ExtraArg[] = []): string {
  return abi.encode(["string", TX_INPUT_TYPE, `${EXTRA_ARG_TYPE}[]`], [fundId, tx, extraArgs]);
}

function registerFundPayload(fund: typeof FUND, creationTx: TxInput, extraArgs: ExtraArg[] = []): string {
  return abi.encode([FUND_INPUT_TYPE, TX_INPUT_TYPE, `${EXTRA_ARG_TYPE}[]`], [fund, creationTx, extraArgs]);
}

function registerOrderPayload(orderId: string, fundId: string, intentHash: string, intent: typeof INTENT, createdAt: bigint): string {
  return abi.encode(["string", "string", "bytes32", ORDER_INTENT_TYPE, "uint256"], [orderId, fundId, intentHash, intent, createdAt]);
}

function progressPayload(orderId: string, progress: number, version: number, updatedAt: bigint): string {
  return abi.encode(["string", "uint8", "uint32", "uint256"], [orderId, progress, version, updatedAt]);
}

const NO_CREATION_TX = { ...FUND_CREATION_TX, txHash: "" };

function metadata(workflowId: string): string {
  return ethers.solidityPacked(["bytes32", "bytes10", "address", "bytes2"], [workflowId, "0x" + "00".repeat(10), ethers.ZeroAddress, "0x0000"]);
}

const WORKFLOW_ID = "0x" + "ab".repeat(32);
const NO_METADATA = "0x";

// ============================================================
// FIXTURES
// ============================================================

/// orderFixture (FUND and ORDER registered, no transactions) plus a MultiChainTxReceiver
/// with nothing configured: no registries set, no roles. `other` plays the forwarder.
async function bareReceiverFixture() {
  const base = await orderFixture();
  const { txRegistry, other: forwarder } = base;

  const receiver = await ethers.deployContract("MultiChainTxReceiver", [forwarder.address, await txRegistry.getAddress()]);
  await receiver.waitForDeployment();

  const chainId = (await ethers.provider.getNetwork()).chainId;

  /// Delivers a report as the forwarder, with a timestamp equal to the latest block by default
  async function report(action: number, payload: string, options: { timestamp?: bigint; metadata?: string } = {}) {
    const timestamp = options.timestamp ?? BigInt(await time.latest());
    return receiver.connect(forwarder).onReport(options.metadata ?? NO_METADATA, encodeReport(chainId, timestamp, action, payload));
  }

  return { ...base, receiver, forwarder, chainId, report };
}

/// bareReceiverFixture plus everything a receiver needs to link transactions:
/// both registries set, and OPERATOR_ROLE in them.
async function receiverFixture() {
  const base = await bareReceiverFixture();
  const { receiver, funds, registry } = base;
  const receiverAddress = await receiver.getAddress();

  await receiver.setOrderRegistry(await registry.getAddress());
  await receiver.setFundRegistry(await funds.getAddress());
  await registry.grantRole(OPERATOR_ROLE, receiverAddress);
  await funds.grantRole(OPERATOR_ROLE, receiverAddress);

  return base;
}

// ============================================================
// TESTS
// ============================================================

describe("MultiChainTxReceiver: orders and funds", function () {
  describe("RECORD_ORDER_TX", function () {
    it("registers the transaction and links it to the order, in one report", async function () {
      const { receiver, registry, txRegistry, report } = await loadFixture(receiverFixture);

      await report(Action.RECORD_ORDER_TX, orderTxPayload(ORDER.orderId, Role.TRANSFER, TRANSFER_INFO, SOURCE_TX));

      // linked to the order
      const txs = await registry.getOrderTxs(ORDER.orderId);
      expect(txs.length).to.equal(1);
      expect(txs[0].orderId).to.equal(ORDER.orderId);
      expect(txs[0].role).to.equal(Role.TRANSFER);
      expect(txs[0].chainId).to.equal(XDC_CHAIN);
      expect(txs[0].connectorId).to.equal(TRANSFER_INFO.connectorId);
      expect(txs[0].standard).to.equal(TRANSFER_INFO.standard);
      expect(txs[0].disposition).to.equal(Disposition.LOCKED);
      expect(txs[0].txId).to.equal(1n);

      // and registered in MultiChainTxRegistry, by the OrderRegistry
      const stored = await txRegistry.getTx(1);
      expect(stored.chainId).to.equal(XDC_CHAIN);
      expect(stored.txHash).to.equal(SOURCE_TX.txHash);
      expect(stored.amount).to.equal(SOURCE_TX.amount);
      expect(stored.registeredBy).to.equal(await registry.getAddress());
      expect(stored.registeredBy).to.not.equal(await receiver.getAddress());
    });

    it("takes the chain from the role: a DELIVERY goes to the destination chain", async function () {
      const { registry, txRegistry, report } = await loadFixture(receiverFixture);

      await report(Action.RECORD_ORDER_TX, orderTxPayload(ORDER.orderId, Role.DELIVERY, DELIVERY_INFO, DESTINATION_TX));

      expect((await registry.getOrderTxs(ORDER.orderId))[0].chainId).to.equal(XRPL_CHAIN);
      expect((await txRegistry.getTx(1)).chainId).to.equal(XRPL_CHAIN);
    });

    it("records the whole order: transfer, lock and delivery", async function () {
      const { registry, txRegistry, report } = await loadFixture(receiverFixture);

      await report(Action.RECORD_ORDER_TX, orderTxPayload(ORDER.orderId, Role.TRANSFER, TRANSFER_INFO, SOURCE_TX));
      await report(Action.RECORD_ORDER_TX, orderTxPayload(ORDER.orderId, Role.LOCK, LOCK_INFO, LOCK_TX));
      await report(Action.RECORD_ORDER_TX, orderTxPayload(ORDER.orderId, Role.DELIVERY, DELIVERY_INFO, DESTINATION_TX));

      const txs = await registry.getOrderTxs(ORDER.orderId);
      expect(txs.map((t) => t.role)).to.deep.equal([Role.TRANSFER, Role.LOCK, Role.DELIVERY]);
      expect(txs.map((t) => t.txId)).to.deep.equal([1n, 2n, 3n]);
      expect(await txRegistry.txCount()).to.equal(3n);
    });

    it("emits OrderTxLinked in the OrderRegistry, with the receiver as operator, and OrderTxRecordedByWorkflow here", async function () {
      const { receiver, registry, report } = await loadFixture(receiverFixture);
      const timestamp = BigInt(await time.latest());

      const tx = report(Action.RECORD_ORDER_TX, orderTxPayload(ORDER.orderId, Role.TRANSFER, TRANSFER_INFO, SOURCE_TX), {
        timestamp,
        metadata: metadata(WORKFLOW_ID),
      });

      await expect(tx)
        .to.emit(registry, "OrderTxLinked")
        .withArgs(keyOf(ORDER.orderId), 0n, Role.TRANSFER, 1n, await receiver.getAddress());
      await expect(tx).to.emit(receiver, "OrderTxRecordedByWorkflow").withArgs(1n, ORDER.orderId, 0n, WORKFLOW_ID, timestamp);
    });

    it("reports the index of the transaction in the list of the order", async function () {
      const { receiver, report } = await loadFixture(receiverFixture);
      await report(Action.RECORD_ORDER_TX, orderTxPayload(ORDER.orderId, Role.TRANSFER, TRANSFER_INFO, SOURCE_TX));

      const timestamp = BigInt(await time.latest());
      await expect(report(Action.RECORD_ORDER_TX, orderTxPayload(ORDER.orderId, Role.LOCK, LOCK_INFO, LOCK_TX), { timestamp }))
        .to.emit(receiver, "OrderTxRecordedByWorkflow")
        .withArgs(2n, ORDER.orderId, 1n, ethers.ZeroHash, timestamp);
    });

    it("passes the extra args through, validated by the schema of the chain", async function () {
      const { txRegistry, report } = await loadFixture(receiverFixture);
      const sequence = ethers.encodeBytes32String("sequence");
      await txRegistry.registerSchemaKey("xrpl:testnet", sequence, "uint32", "", true);

      await expect(
        report(Action.RECORD_ORDER_TX, orderTxPayload(ORDER.orderId, Role.DELIVERY, DELIVERY_INFO, DESTINATION_TX)),
      ).to.be.revertedWith("Missing required extra arg");

      const args = [{ key: sequence, value: abi.encode(["uint32"], [20725947]) }];
      await report(Action.RECORD_ORDER_TX, orderTxPayload(ORDER.orderId, Role.DELIVERY, DELIVERY_INFO, DESTINATION_TX, args));

      expect((await txRegistry.getExtraArgs(1)).length).to.equal(1);
    });

    it("rejects a replayed report: the transaction is already registered", async function () {
      const { registry, report } = await loadFixture(receiverFixture);
      const payload = orderTxPayload(ORDER.orderId, Role.TRANSFER, TRANSFER_INFO, SOURCE_TX);
      const timestamp = BigInt(await time.latest());

      await report(Action.RECORD_ORDER_TX, payload, { timestamp });
      await expect(report(Action.RECORD_ORDER_TX, payload, { timestamp })).to.be.revertedWith("Tx already registered");

      expect(await registry.getOrderTxCount(ORDER.orderId)).to.equal(1n);
    });

    it("rejects an unknown order, an unknown role and a deprecated role", async function () {
      const { registry, report } = await loadFixture(receiverFixture);

      await expect(
        report(Action.RECORD_ORDER_TX, orderTxPayload("nope", Role.TRANSFER, TRANSFER_INFO, SOURCE_TX)),
      ).to.be.revertedWith("Unknown order");
      await expect(
        report(Action.RECORD_ORDER_TX, orderTxPayload(ORDER.orderId, ethers.encodeBytes32String("REFUND"), TRANSFER_INFO, SOURCE_TX)),
      ).to.be.revertedWith("Unknown role");

      await registry.setOrderTxRoleActive(Role.TRANSFER, false);
      await expect(
        report(Action.RECORD_ORDER_TX, orderTxPayload(ORDER.orderId, Role.TRANSFER, TRANSFER_INFO, SOURCE_TX)),
      ).to.be.revertedWith("Role deprecated");
    });

    it("reverts while the OrderRegistry is not set", async function () {
      const { receiver, report } = await loadFixture(bareReceiverFixture);

      await expect(
        report(Action.RECORD_ORDER_TX, orderTxPayload(ORDER.orderId, Role.TRANSFER, TRANSFER_INFO, SOURCE_TX)),
      ).to.be.revertedWithCustomError(receiver, "OrderRegistryNotSet");
    });

    it("reverts when the receiver does not have OPERATOR_ROLE in the OrderRegistry", async function () {
      const { receiver, registry, report } = await loadFixture(bareReceiverFixture);
      await receiver.setOrderRegistry(await registry.getAddress());

      await expect(report(Action.RECORD_ORDER_TX, orderTxPayload(ORDER.orderId, Role.TRANSFER, TRANSFER_INFO, SOURCE_TX)))
        .to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount")
        .withArgs(await receiver.getAddress(), OPERATOR_ROLE);
    });

    it("does not need RELAYER_ROLE: the OrderRegistry is the relayer", async function () {
      const { receiver, txRegistry, report } = await loadFixture(receiverFixture);
      expect(await txRegistry.hasRole(RELAYER_ROLE, await receiver.getAddress())).to.equal(false);

      await expect(
        report(Action.RECORD_ORDER_TX, orderTxPayload(ORDER.orderId, Role.TRANSFER, TRANSFER_INFO, SOURCE_TX)),
      ).to.not.revert(ethers);
    });
  });

  describe("RECORD_FUND_CREATION_TX", function () {
    it("registers the creation transaction and links it to the fund", async function () {
      const { receiver, funds, txRegistry, report } = await loadFixture(receiverFixture);
      const timestamp = BigInt(await time.latest());

      const tx = report(Action.RECORD_FUND_CREATION_TX, fundCreationPayload(FUND.fundId, FUND_CREATION_TX), {
        timestamp,
        metadata: metadata(WORKFLOW_ID),
      });

      await expect(tx).to.emit(funds, "FundCreationTxLinked").withArgs(keyOf(FUND.fundId), 1n);
      await expect(tx).to.emit(receiver, "FundCreationTxRecordedByWorkflow").withArgs(1n, FUND.fundId, WORKFLOW_ID, timestamp);

      const fund = await funds.getFund(FUND.fundId);
      expect(fund.creationTxId).to.equal(1n);
      expect(fund.creationTxHash).to.equal(FUND_CREATION_TX.txHash);

      // registered on the chain of the fund, by the FundRegistry
      const stored = await txRegistry.getTx(1);
      expect(stored.chainId).to.equal(FUND.chainId);
      expect(stored.txHash).to.equal(FUND_CREATION_TX.txHash);
      expect(stored.registeredBy).to.equal(await funds.getAddress());
    });

    it("rejects a second creation transaction for the same fund, so a replay cannot link twice", async function () {
      const { report } = await loadFixture(receiverFixture);
      const payload = fundCreationPayload(FUND.fundId, FUND_CREATION_TX);

      await report(Action.RECORD_FUND_CREATION_TX, payload);
      await expect(report(Action.RECORD_FUND_CREATION_TX, payload)).to.be.revertedWith("Creation tx already linked");
      await expect(
        report(Action.RECORD_FUND_CREATION_TX, fundCreationPayload(FUND.fundId, { ...FUND_CREATION_TX, txHash: "0xabc" })),
      ).to.be.revertedWith("Creation tx already linked");
    });

    it("rejects an unknown fund", async function () {
      const { report } = await loadFixture(receiverFixture);
      await expect(
        report(Action.RECORD_FUND_CREATION_TX, fundCreationPayload("nope", FUND_CREATION_TX)),
      ).to.be.revertedWith("Unknown fund");
    });

    it("reverts while the FundRegistry is not set", async function () {
      const { receiver, report } = await loadFixture(bareReceiverFixture);
      await expect(
        report(Action.RECORD_FUND_CREATION_TX, fundCreationPayload(FUND.fundId, FUND_CREATION_TX)),
      ).to.be.revertedWithCustomError(receiver, "FundRegistryNotSet");
    });

    it("reverts when the receiver does not have OPERATOR_ROLE in the FundRegistry", async function () {
      const { receiver, funds, report } = await loadFixture(bareReceiverFixture);
      await receiver.setFundRegistry(await funds.getAddress());

      await expect(report(Action.RECORD_FUND_CREATION_TX, fundCreationPayload(FUND.fundId, FUND_CREATION_TX)))
        .to.be.revertedWithCustomError(funds, "AccessControlUnauthorizedAccount")
        .withArgs(await receiver.getAddress(), OPERATOR_ROLE);
    });
  });

  describe("Standalone and linked transactions together", function () {
    it("updates the status of a transaction of an order with UPDATE_TX_STATUS", async function () {
      const { receiver, txRegistry, report } = await loadFixture(receiverFixture);
      // UPDATE_TX_STATUS writes in MultiChainTxRegistry directly, so it needs RELAYER_ROLE
      await txRegistry.grantRole(RELAYER_ROLE, await receiver.getAddress());

      await report(Action.RECORD_ORDER_TX, orderTxPayload(ORDER.orderId, Role.TRANSFER, TRANSFER_INFO, { ...SOURCE_TX, status: TxStatus.PENDING }));

      const payload = abi.encode(["uint256", "uint8"], [1n, TxStatus.CONFIRMED]);
      await report(Action.UPDATE_TX_STATUS, payload, { timestamp: BigInt(await time.latest()) + 1n });

      expect((await txRegistry.getTx(1)).status).to.equal(BigInt(TxStatus.CONFIRMED));
    });

    it("cannot link to an order a transaction that was registered on its own", async function () {
      const { receiver, registry, txRegistry, report } = await loadFixture(receiverFixture);
      await txRegistry.grantRole(RELAYER_ROLE, await receiver.getAddress());

      // registered standalone first
      await report(
        Action.REGISTER_TX,
        abi.encode(["bytes32", TX_INPUT_TYPE, `${EXTRA_ARG_TYPE}[]`], [XDC_CHAIN, SOURCE_TX, []]),
      );

      // the same transaction can no longer be recorded for the order
      await expect(
        report(Action.RECORD_ORDER_TX, orderTxPayload(ORDER.orderId, Role.TRANSFER, TRANSFER_INFO, SOURCE_TX)),
      ).to.be.revertedWith("Tx already registered");
      expect(await registry.getOrderTxCount(ORDER.orderId)).to.equal(0n);
    });
  });

  describe("setOrderRegistry / setFundRegistry", function () {
    it("start empty", async function () {
      const { receiver } = await loadFixture(bareReceiverFixture);
      expect(await receiver.orderRegistry()).to.equal(ethers.ZeroAddress);
      expect(await receiver.fundRegistry()).to.equal(ethers.ZeroAddress);
    });

    it("let the admin set both registries, emitting the update events", async function () {
      const { receiver, funds, registry } = await loadFixture(bareReceiverFixture);

      await expect(receiver.setOrderRegistry(await registry.getAddress()))
        .to.emit(receiver, "OrderRegistryUpdated")
        .withArgs(ethers.ZeroAddress, await registry.getAddress());
      await expect(receiver.setFundRegistry(await funds.getAddress()))
        .to.emit(receiver, "FundRegistryUpdated")
        .withArgs(ethers.ZeroAddress, await funds.getAddress());

      expect(await receiver.orderRegistry()).to.equal(await registry.getAddress());
      expect(await receiver.fundRegistry()).to.equal(await funds.getAddress());
    });

    it("disable the action when set back to zero", async function () {
      const { receiver, report } = await loadFixture(receiverFixture);

      await receiver.setOrderRegistry(ethers.ZeroAddress);
      await expect(
        report(Action.RECORD_ORDER_TX, orderTxPayload(ORDER.orderId, Role.TRANSFER, TRANSFER_INFO, SOURCE_TX)),
      ).to.be.revertedWithCustomError(receiver, "OrderRegistryNotSet");

      await receiver.setFundRegistry(ethers.ZeroAddress);
      await expect(
        report(Action.RECORD_FUND_CREATION_TX, fundCreationPayload(FUND.fundId, FUND_CREATION_TX)),
      ).to.be.revertedWithCustomError(receiver, "FundRegistryNotSet");
    });

    it("reject a registry that uses another MultiChainTxRegistry", async function () {
      const { receiver, txRegistry } = await loadFixture(bareReceiverFixture);

      const otherTxRegistry = await ethers.deployContract("MultiChainTxRegistry");
      await otherTxRegistry.waitForDeployment();
      const otherFunds = await ethers.deployContract("FundRegistry", [await otherTxRegistry.getAddress()]);
      await otherFunds.waitForDeployment();
      const otherOrders = await ethers.deployContract("OrderRegistry", [await otherTxRegistry.getAddress(), await otherFunds.getAddress()]);
      await otherOrders.waitForDeployment();

      await expect(receiver.setFundRegistry(await otherFunds.getAddress()))
        .to.be.revertedWithCustomError(receiver, "RegistryMismatch")
        .withArgs(await otherFunds.getAddress(), await otherTxRegistry.getAddress(), await txRegistry.getAddress());
      await expect(receiver.setOrderRegistry(await otherOrders.getAddress()))
        .to.be.revertedWithCustomError(receiver, "RegistryMismatch")
        .withArgs(await otherOrders.getAddress(), await otherTxRegistry.getAddress(), await txRegistry.getAddress());
    });

    it("reject non-admin callers, including the forwarder", async function () {
      const { receiver, funds, registry, forwarder } = await loadFixture(bareReceiverFixture);

      await expect(receiver.connect(forwarder).setOrderRegistry(await registry.getAddress()))
        .to.be.revertedWithCustomError(receiver, "AccessControlUnauthorizedAccount")
        .withArgs(forwarder.address, ADMIN_ROLE);
      await expect(receiver.connect(forwarder).setFundRegistry(await funds.getAddress()))
        .to.be.revertedWithCustomError(receiver, "AccessControlUnauthorizedAccount")
        .withArgs(forwarder.address, ADMIN_ROLE);
    });
  });

  describe("REGISTER_FUND", function () {
    it("registers a fund without creation transaction", async function () {
      const { receiver, funds, txRegistry, report } = await loadFixture(receiverFixture);
      const timestamp = BigInt(await time.latest());

      const tx = report(Action.REGISTER_FUND, registerFundPayload(FUND2, NO_CREATION_TX), { timestamp, metadata: metadata(WORKFLOW_ID) });

      await expect(tx).to.emit(funds, "FundRegistered").withArgs(keyOf(FUND2.fundId), FUND2.fundId, FUND2.fidcId, FUND2.chainId);
      await expect(tx).to.emit(receiver, "FundRegisteredByWorkflow").withArgs(keyOf(FUND2.fundId), FUND2.fundId, WORKFLOW_ID, timestamp);

      const fund = await funds.getFund(FUND2.fundId);
      expect(fund.fundId).to.equal(FUND2.fundId);
      expect(fund.fidcId).to.equal(FUND2.fidcId);
      expect(fund.name).to.equal(FUND2.name);
      expect(fund.chain.chainId).to.equal(FUND2.chainId);
      expect(fund.contractAddress).to.equal(ethers.getAddress(FUND2.contractAddress));
      expect(fund.stable.symbol).to.equal(STABLE.symbol);
      expect(fund.creationTxId).to.equal(0n);

      expect(await funds.getFundCount()).to.equal(2n);
      expect(await txRegistry.txCount()).to.equal(0n);
    });

    it("registers the creation transaction too, when the payload has its hash", async function () {
      const { funds, txRegistry, report } = await loadFixture(receiverFixture);

      await report(Action.REGISTER_FUND, registerFundPayload(FUND2, FUND_CREATION_TX));

      const fund = await funds.getFund(FUND2.fundId);
      expect(fund.creationTxId).to.equal(1n);
      expect(fund.creationTxHash).to.equal(FUND_CREATION_TX.txHash);

      const stored = await txRegistry.getTx(1);
      expect(stored.chainId).to.equal(FUND2.chainId);
      expect(stored.registeredBy).to.equal(await funds.getAddress());
    });

    it("rejects a replayed report: the fund is already registered", async function () {
      const { funds, report } = await loadFixture(receiverFixture);
      const payload = registerFundPayload(FUND2, NO_CREATION_TX);

      await report(Action.REGISTER_FUND, payload);
      await expect(report(Action.REGISTER_FUND, payload)).to.be.revertedWith("Fund already registered");
      expect(await funds.getFundCount()).to.equal(2n);
    });

    it("rejects a fund whose stablecoin or chain is not registered", async function () {
      const { report, other } = await loadFixture(receiverFixture);

      await expect(
        report(Action.REGISTER_FUND, registerFundPayload({ ...FUND2, stableAddress: other.address }, NO_CREATION_TX)),
      ).to.be.revertedWith("Stable not registered");
      await expect(
        report(Action.REGISTER_FUND, registerFundPayload({ ...FUND2, chainId: keyOf("eip155:1") }, NO_CREATION_TX)),
      ).to.be.revertedWith("Chain not registered");
    });

    it("reverts while the FundRegistry is not set, and without OPERATOR_ROLE", async function () {
      const { receiver, funds, report } = await loadFixture(bareReceiverFixture);
      const payload = registerFundPayload(FUND2, NO_CREATION_TX);

      await expect(report(Action.REGISTER_FUND, payload)).to.be.revertedWithCustomError(receiver, "FundRegistryNotSet");

      await receiver.setFundRegistry(await funds.getAddress());
      await expect(report(Action.REGISTER_FUND, payload))
        .to.be.revertedWithCustomError(funds, "AccessControlUnauthorizedAccount")
        .withArgs(await receiver.getAddress(), OPERATOR_ROLE);
    });
  });

  describe("REGISTER_ORDER", function () {
    /// receiverFixture plus FUND2 registered, which is the fund of ORDER2
    async function fund2Fixture() {
      const base = await receiverFixture();
      await base.report(Action.REGISTER_FUND, registerFundPayload(FUND2, NO_CREATION_TX));
      return base;
    }

    const order2Payload = registerOrderPayload(ORDER2.orderId, FUND2.fundId, ORDER2.intentHash, INTENT2, ORDER2.createdAt);

    it("registers the order and its intent", async function () {
      const { receiver, registry, report } = await loadFixture(fund2Fixture);
      const timestamp = BigInt(await time.latest());

      const tx = report(Action.REGISTER_ORDER, order2Payload, { timestamp, metadata: metadata(WORKFLOW_ID) });

      await expect(tx)
        .to.emit(registry, "OrderRegistered")
        .withArgs(keyOf(ORDER2.orderId), keyOf(FUND2.fundId), ORDER2.orderId, ORDER2.intentHash);
      await expect(tx).to.emit(receiver, "OrderRegisteredByWorkflow").withArgs(keyOf(ORDER2.orderId), ORDER2.orderId, WORKFLOW_ID, timestamp);

      const order = await registry.getOrder(ORDER2.orderId);
      expect(order.orderId).to.equal(ORDER2.orderId);
      expect(order.fundKey).to.equal(keyOf(FUND2.fundId));
      expect(order.intentHash).to.equal(ORDER2.intentHash);
      expect(order.progress).to.equal(BigInt(OrderProgress.AWAITING_ORIGIN));
      expect(order.createdAt).to.equal(ORDER2.createdAt);

      const intent = await registry.getOrderIntent(ORDER2.orderId);
      expect(intent.orderId).to.equal(INTENT2.orderId);
      expect(intent.cashToken).to.equal(ethers.getAddress(INTENT2.cashToken));
      expect(intent.validUntil).to.equal(INTENT2.validUntil);
      expect(intent.beneficiary).to.equal(ethers.getAddress(INTENT2.beneficiary));
      expect(intent.sourceChainId).to.equal(XDC_CHAIN);
      expect(intent.destinationChainId).to.equal(STELLAR_CHAIN);

      expect(await registry.getOrdersByFund(FUND2.fundId)).to.deep.equal([ORDER2.orderId]);
    });

    it("rejects a replayed report: the order is already registered", async function () {
      const { report } = await loadFixture(fund2Fixture);

      await report(Action.REGISTER_ORDER, order2Payload);
      await expect(report(Action.REGISTER_ORDER, order2Payload)).to.be.revertedWith("Order already registered");
    });

    it("applies the same checks of the intent against the fund", async function () {
      const { report } = await loadFixture(fund2Fixture);
      const payload = (intent: typeof INTENT) =>
        registerOrderPayload(ORDER2.orderId, FUND2.fundId, ORDER2.intentHash, intent, ORDER2.createdAt);

      await expect(
        report(Action.REGISTER_ORDER, registerOrderPayload(ORDER2.orderId, "nope", ORDER2.intentHash, INTENT2, ORDER2.createdAt)),
      ).to.be.revertedWith("Unknown fund");
      await expect(report(Action.REGISTER_ORDER, payload({ ...INTENT2, sourceChainId: XRPL_CHAIN }))).to.be.revertedWith("Source chain != fund chain");
      await expect(report(Action.REGISTER_ORDER, payload({ ...INTENT2, sourceAccount: INTENT2.beneficiary }))).to.be.revertedWith("Source account != fund contract");
      await expect(report(Action.REGISTER_ORDER, payload({ ...INTENT2, cashToken: INTENT2.beneficiary }))).to.be.revertedWith("Cash token != fund stable");
      await expect(report(Action.REGISTER_ORDER, payload({ ...INTENT2, orderId: "another-order" }))).to.be.revertedWith("Intent orderId mismatch");
    });

    it("reverts while the OrderRegistry is not set, and without OPERATOR_ROLE", async function () {
      const { receiver, registry, report } = await loadFixture(bareReceiverFixture);
      const payload = registerOrderPayload("order-9", FUND.fundId, "0x" + "77".repeat(32), { ...INTENT, orderId: "order-9" }, ORDER.createdAt);

      await expect(report(Action.REGISTER_ORDER, payload)).to.be.revertedWithCustomError(receiver, "OrderRegistryNotSet");

      await receiver.setOrderRegistry(await registry.getAddress());
      await expect(report(Action.REGISTER_ORDER, payload))
        .to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount")
        .withArgs(await receiver.getAddress(), OPERATOR_ROLE);
    });
  });

  describe("UPDATE_ORDER_PROGRESS", function () {
    it("updates the progress, the version and updatedAt of the order", async function () {
      const { receiver, registry, report } = await loadFixture(receiverFixture);
      const timestamp = BigInt(await time.latest());
      const updatedAt = ORDER.createdAt + 1159n;

      const tx = report(Action.UPDATE_ORDER_PROGRESS, progressPayload(ORDER.orderId, OrderProgress.ACQUIRED_WITH_LOCK, 3, updatedAt), {
        timestamp,
        metadata: metadata(WORKFLOW_ID),
      });

      await expect(tx).to.emit(registry, "OrderProgressUpdated").withArgs(keyOf(ORDER.orderId), OrderProgress.ACQUIRED_WITH_LOCK, 3);
      await expect(tx)
        .to.emit(receiver, "OrderProgressUpdatedByWorkflow")
        .withArgs(ORDER.orderId, OrderProgress.ACQUIRED_WITH_LOCK, 3, WORKFLOW_ID, timestamp);

      const order = await registry.getOrder(ORDER.orderId);
      expect(order.progress).to.equal(BigInt(OrderProgress.ACQUIRED_WITH_LOCK));
      expect(order.version).to.equal(3n);
      expect(order.updatedAt).to.equal(updatedAt);
      expect(order.createdAt).to.equal(ORDER.createdAt);
    });

    it("rejects a replayed or older report, so a previous progress cannot come back", async function () {
      const { registry, report } = await loadFixture(receiverFixture);
      const first = progressPayload(ORDER.orderId, OrderProgress.AWAITING_DELIVERY, 2, ORDER.createdAt + 100n);
      const second = progressPayload(ORDER.orderId, OrderProgress.ACQUIRED_WITH_LOCK, 3, ORDER.createdAt + 200n);

      await report(Action.UPDATE_ORDER_PROGRESS, first);
      await report(Action.UPDATE_ORDER_PROGRESS, second);

      // the first report again: lower version
      await expect(report(Action.UPDATE_ORDER_PROGRESS, first)).to.be.revertedWith("Stale version");
      // the second report again: same updatedAt
      await expect(report(Action.UPDATE_ORDER_PROGRESS, second)).to.be.revertedWith("updatedAt not after previous");

      expect((await registry.getOrder(ORDER.orderId)).progress).to.equal(BigInt(OrderProgress.ACQUIRED_WITH_LOCK));
    });

    it("rejects an unknown order and an updatedAt before createdAt", async function () {
      const { report } = await loadFixture(receiverFixture);

      await expect(
        report(Action.UPDATE_ORDER_PROGRESS, progressPayload("nope", OrderProgress.AWAITING_DELIVERY, 2, ORDER.createdAt + 1n)),
      ).to.be.revertedWith("Unknown order");
      await expect(
        report(Action.UPDATE_ORDER_PROGRESS, progressPayload(ORDER.orderId, OrderProgress.AWAITING_DELIVERY, 2, ORDER.createdAt - 1n)),
      ).to.be.revertedWith("updatedAt before createdAt");
    });

    it("rejects a progress outside the enum", async function () {
      const { report } = await loadFixture(receiverFixture);
      // 3 is outside OrderProgress: the ABI decoder reverts
      await expect(
        report(Action.UPDATE_ORDER_PROGRESS, progressPayload(ORDER.orderId, 3, 2, ORDER.createdAt + 1n)),
      ).to.be.revertedWithoutReason(ethers);
    });

    it("reverts while the OrderRegistry is not set, and without OPERATOR_ROLE", async function () {
      const { receiver, registry, report } = await loadFixture(bareReceiverFixture);
      const payload = progressPayload(ORDER.orderId, OrderProgress.AWAITING_DELIVERY, 2, ORDER.createdAt + 1n);

      await expect(report(Action.UPDATE_ORDER_PROGRESS, payload)).to.be.revertedWithCustomError(receiver, "OrderRegistryNotSet");

      await receiver.setOrderRegistry(await registry.getAddress());
      await expect(report(Action.UPDATE_ORDER_PROGRESS, payload))
        .to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount")
        .withArgs(await receiver.getAddress(), OPERATOR_ROLE);
    });
  });

  // A whole order kept only by reports: fund, order, its transactions and its progress
  describe("Scenario: a fund and an order maintained by a workflow", function () {
    it("registers the fund, the order, the delivery and the progress", async function () {
      const { funds, registry, txRegistry, report } = await loadFixture(receiverFixture);

      await report(Action.REGISTER_FUND, registerFundPayload(FUND2, FUND_CREATION_TX));                                             // tx 1
      await report(Action.REGISTER_ORDER, registerOrderPayload(ORDER2.orderId, FUND2.fundId, ORDER2.intentHash, INTENT2, ORDER2.createdAt));
      await report(Action.RECORD_ORDER_TX, orderTxPayload(ORDER2.orderId, Role.DELIVERY, DELIVERY2_INFO, DESTINATION2_TX));          // tx 2
      await report(Action.UPDATE_ORDER_PROGRESS, progressPayload(ORDER2.orderId, OrderProgress.AWAITING_DELIVERY, 2, ORDER2.createdAt + 519n));

      expect((await funds.getFund(FUND2.fundId)).creationTxId).to.equal(1n);
      expect(await registry.getOrdersByFund(FUND2.fundId)).to.deep.equal([ORDER2.orderId]);

      const order = await registry.getOrder(ORDER2.orderId);
      expect(order.progress).to.equal(BigInt(OrderProgress.AWAITING_DELIVERY));
      expect(order.version).to.equal(2n);

      const txs = await registry.getOrderTxs(ORDER2.orderId);
      expect(txs.length).to.equal(1);
      expect(txs[0].role).to.equal(Role.DELIVERY);
      expect(txs[0].chainId).to.equal(STELLAR_CHAIN);
      expect(txs[0].txId).to.equal(2n);

      expect(await txRegistry.txCount()).to.equal(2n);
      expect((await txRegistry.getTx(2)).chainId).to.equal(STELLAR_CHAIN);
    });
  });
});
