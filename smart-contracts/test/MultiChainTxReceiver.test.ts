import { expect } from "chai";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.create();
const { loadFixture, time } = networkHelpers;

const abi = ethers.AbiCoder.defaultAbiCoder();

// AccessControl role ids
const ADMIN_ROLE = ethers.ZeroHash; // DEFAULT_ADMIN_ROLE
const RELAYER_ROLE = ethers.id("RELAYER_ROLE");

enum TxStatus {
  PENDING = 0,
  CONFIRMED = 1,
  FAILED = 2,
}

enum Action {
  REGISTER_TX = 0,
  UPDATE_TX_STATUS = 1,
}

// ============================================================
// REPORT ENCODING (what a CRE workflow does before runtime.report)
// ============================================================

const TX_INPUT_TYPE =
  "tuple(uint8 status, string txHash, string from, string to, uint256 amount, string assetCode, " +
  "string assetIssuer, string txType, bytes data, string dataType, uint256 blockNumber, uint256 timestamp)";
const EXTRA_ARG_TYPE = "tuple(bytes32 key, bytes value)";
const REPORT_TYPE = "tuple(uint256 targetChainId, uint64 timestamp, uint8 action, bytes payload)";

type ExtraArg = { key: string; value: string };

function encodeReport(targetChainId: bigint, timestamp: bigint, action: number, payload: string): string {
  return abi.encode([REPORT_TYPE], [{ targetChainId, timestamp, action, payload }]);
}

function registerPayload(chainId: string, tx: typeof XDC_TX, extraArgs: ExtraArg[] = []): string {
  return abi.encode(["bytes32", TX_INPUT_TYPE, `${EXTRA_ARG_TYPE}[]`], [chainId, tx, extraArgs]);
}

function statusPayload(txId: bigint, status: number): string {
  return abi.encode(["uint256", "uint8"], [txId, status]);
}

// Metadata as delivered by the KeystoneForwarder: 62 bytes of workflow identity + bytes2 reportId
function metadata(workflowId: string, workflowName: string, workflowOwner: string): string {
  return ethers.solidityPacked(["bytes32", "bytes10", "address", "bytes2"], [workflowId, workflowName, workflowOwner, "0x0000"]);
}

// A workflow name travels as the first 10 hex characters of sha256(name), as ASCII bytes
function encodeWorkflowName(name: string): string {
  const first10 = ethers.sha256(ethers.toUtf8Bytes(name)).slice(2, 12);
  return ethers.hexlify(ethers.toUtf8Bytes(first10));
}

const WORKFLOW_ID = "0x" + "ab".repeat(32);
const OTHER_WORKFLOW_ID = "0x" + "cd".repeat(32);
const WORKFLOW_NAME = "tx-registry";
const NO_METADATA = "0x";

// ============================================================
// SAMPLE DATA (query-json/orders.json, first order)
// ============================================================

const XDC_NETWORK = "eip155:51";
const XDC_CHAIN = ethers.keccak256(ethers.toUtf8Bytes(XDC_NETWORK));

const XDC_TX = {
  status: TxStatus.CONFIRMED,
  txHash: "0xc05065f06907f834a6c68b750a8d365feca8cd0740fea6563d17738817a67233",
  from: "0x8001BB21f4F061b444F02f50Ab76BAA6a84394A2",
  to: "0xB4F6aAd0196D058353835c68B89F1F06c16490EF",
  amount: 100n * 10n ** 18n,
  assetCode: "BRL-CVM",
  assetIssuer: "0x243e98638D619eB6f10eaBbaCfC071f318D5e9d0",
  txType: "transfer",
  data: "0x",
  dataType: "",
  blockNumber: 86721398n,
  timestamp: 0n,
};

// ============================================================
// FIXTURES
// ============================================================

/// MultiChainTxRegistry with the XDC chain, and a MultiChainTxReceiver that has RELAYER_ROLE.
/// `forwarder` is an account playing the KeystoneForwarder: the only one allowed to call onReport.
async function deployFixture() {
  const [owner, forwarder, workflowOwner, other] = await ethers.getSigners();

  const txRegistry = await ethers.deployContract("MultiChainTxRegistry");
  await txRegistry.waitForDeployment();
  await txRegistry.registerChain(XDC_NETWORK, "51", "XDC", "xdc-apothem", ethers.ZeroHash);

  const receiver = await ethers.deployContract("MultiChainTxReceiver", [forwarder.address, await txRegistry.getAddress()]);
  await receiver.waitForDeployment();
  await txRegistry.grantRole(RELAYER_ROLE, await receiver.getAddress());

  const chainId = (await ethers.provider.getNetwork()).chainId;

  /// Delivers a report as the forwarder, with a timestamp equal to the latest block by default
  async function report(action: number, payload: string, options: { timestamp?: bigint; metadata?: string; targetChainId?: bigint } = {}) {
    const timestamp = options.timestamp ?? BigInt(await time.latest());
    return receiver
      .connect(forwarder)
      .onReport(options.metadata ?? NO_METADATA, encodeReport(options.targetChainId ?? chainId, timestamp, action, payload));
  }

  return { txRegistry, receiver, owner, forwarder, workflowOwner, other, chainId, report };
}

/// deployFixture plus XDC_TX registered through a report (tx id 1).
async function registeredFixture() {
  const base = await deployFixture();
  const registeredAt = BigInt(await time.latest());
  await base.report(Action.REGISTER_TX, registerPayload(XDC_CHAIN, { ...XDC_TX, status: TxStatus.PENDING }), { timestamp: registeredAt });
  return { ...base, registeredAt };
}

// ============================================================
// TESTS
// ============================================================

describe("MultiChainTxReceiver", function () {
  describe("Deployment", function () {
    it("stores the forwarder and the MultiChainTxRegistry, and makes the deployer admin", async function () {
      const { receiver, txRegistry, owner, forwarder } = await loadFixture(deployFixture);

      expect(await receiver.getForwarderAddress()).to.equal(forwarder.address);
      expect(await receiver.txRegistry()).to.equal(await txRegistry.getAddress());
      expect(await receiver.hasRole(ADMIN_ROLE, owner.address)).to.equal(true);
    });

    it("starts with no workflow restriction", async function () {
      const { receiver } = await loadFixture(deployFixture);

      expect(await receiver.getExpectedWorkflowId()).to.equal(ethers.ZeroHash);
      expect(await receiver.getExpectedAuthor()).to.equal(ethers.ZeroAddress);
      expect(await receiver.getExpectedWorkflowName()).to.equal("0x" + "00".repeat(10));
    });

    it("emits ForwarderAddressUpdated on deployment", async function () {
      const { receiver, forwarder } = await loadFixture(deployFixture);
      await expect(receiver.deploymentTransaction())
        .to.emit(receiver, "ForwarderAddressUpdated")
        .withArgs(ethers.ZeroAddress, forwarder.address);
    });

    it("rejects a zero forwarder and a zero registry", async function () {
      const { receiver, txRegistry, forwarder } = await loadFixture(deployFixture);

      await expect(
        ethers.deployContract("MultiChainTxReceiver", [ethers.ZeroAddress, await txRegistry.getAddress()]),
      ).to.be.revertedWithCustomError(receiver, "InvalidForwarderAddress");
      await expect(
        ethers.deployContract("MultiChainTxReceiver", [forwarder.address, ethers.ZeroAddress]),
      ).to.be.revertedWith("Zero registry");
    });

    it("declares the IReceiver, ERC165 and AccessControl interfaces", async function () {
      const { receiver } = await loadFixture(deployFixture);

      // the forwarder checks IReceiver through ERC165 before delivering a report
      const IRECEIVER = ethers.id("onReport(bytes,bytes)").slice(0, 10);
      expect(await receiver.supportsInterface(IRECEIVER)).to.equal(true);
      expect(await receiver.supportsInterface("0x01ffc9a7")).to.equal(true); // IERC165
      expect(await receiver.supportsInterface("0x7965db0b")).to.equal(true); // IAccessControl
      expect(await receiver.supportsInterface("0xffffffff")).to.equal(false);
    });
  });

  describe("onReport: sender", function () {
    it("accepts a report delivered by the forwarder", async function () {
      const { report } = await loadFixture(deployFixture);
      await expect(report(Action.REGISTER_TX, registerPayload(XDC_CHAIN, XDC_TX))).to.not.revert(ethers);
    });

    it("rejects any other caller, including the admin", async function () {
      const { receiver, owner, forwarder, other, chainId } = await loadFixture(deployFixture);
      const encoded = encodeReport(chainId, BigInt(await time.latest()), Action.REGISTER_TX, registerPayload(XDC_CHAIN, XDC_TX));

      await expect(receiver.connect(other).onReport(NO_METADATA, encoded))
        .to.be.revertedWithCustomError(receiver, "InvalidSender")
        .withArgs(other.address, forwarder.address);
      await expect(receiver.connect(owner).onReport(NO_METADATA, encoded))
        .to.be.revertedWithCustomError(receiver, "InvalidSender")
        .withArgs(owner.address, forwarder.address);
    });
  });

  describe("REGISTER_TX", function () {
    it("registers the transaction in MultiChainTxRegistry", async function () {
      const { receiver, txRegistry, report } = await loadFixture(deployFixture);

      await report(Action.REGISTER_TX, registerPayload(XDC_CHAIN, XDC_TX));

      expect(await txRegistry.txCount()).to.equal(1n);

      const stored = await txRegistry.getTx(1);
      expect(stored.chainId).to.equal(XDC_CHAIN);
      expect(stored.status).to.equal(BigInt(TxStatus.CONFIRMED));
      expect(stored.txHash).to.equal(XDC_TX.txHash);
      expect(stored.from).to.equal(XDC_TX.from);
      expect(stored.to).to.equal(XDC_TX.to);
      expect(stored.amount).to.equal(XDC_TX.amount);
      expect(stored.assetCode).to.equal(XDC_TX.assetCode);
      expect(stored.assetIssuer).to.equal(XDC_TX.assetIssuer);
      expect(stored.txType).to.equal(XDC_TX.txType);
      expect(stored.blockNumber).to.equal(XDC_TX.blockNumber);
      // the relayer that registered is the receiver, not the forwarder
      expect(stored.registeredBy).to.equal(await receiver.getAddress());
    });

    it("emits TxRegistered in the registry and TxRegisteredByWorkflow here", async function () {
      const { receiver, txRegistry, report } = await loadFixture(deployFixture);
      const timestamp = BigInt(await time.latest());

      const tx = report(Action.REGISTER_TX, registerPayload(XDC_CHAIN, XDC_TX), {
        timestamp,
        metadata: metadata(WORKFLOW_ID, encodeWorkflowName(WORKFLOW_NAME), ethers.ZeroAddress),
      });

      await expect(tx).to.emit(txRegistry, "TxRegistered").withArgs(1n, XDC_CHAIN, XDC_TX.txHash, await receiver.getAddress());
      await expect(tx).to.emit(receiver, "TxRegisteredByWorkflow").withArgs(1n, XDC_CHAIN, WORKFLOW_ID, timestamp);
    });

    it("records a zero workflowId when the forwarder sends no metadata (simulation)", async function () {
      const { receiver, report } = await loadFixture(deployFixture);
      const timestamp = BigInt(await time.latest());

      await expect(report(Action.REGISTER_TX, registerPayload(XDC_CHAIN, XDC_TX), { timestamp }))
        .to.emit(receiver, "TxRegisteredByWorkflow")
        .withArgs(1n, XDC_CHAIN, ethers.ZeroHash, timestamp);
    });

    it("passes the extra args through, validated by the schema of the chain", async function () {
      const { txRegistry, report } = await loadFixture(deployFixture);
      const logIndex = ethers.encodeBytes32String("logIndex");
      await txRegistry.registerSchemaKey(XDC_NETWORK, logIndex, "uint256", "", true);

      await expect(report(Action.REGISTER_TX, registerPayload(XDC_CHAIN, XDC_TX))).to.be.revertedWith("Missing required extra arg");

      await report(Action.REGISTER_TX, registerPayload(XDC_CHAIN, XDC_TX, [{ key: logIndex, value: abi.encode(["uint256"], [0]) }]));

      const stored = await txRegistry.getExtraArgs(1);
      expect(stored.length).to.equal(1);
      expect(stored[0].key).to.equal(logIndex);
    });

    it("rejects a replayed report: the transaction is already registered", async function () {
      const { txRegistry, report } = await loadFixture(deployFixture);
      const payload = registerPayload(XDC_CHAIN, XDC_TX);
      const timestamp = BigInt(await time.latest());

      await report(Action.REGISTER_TX, payload, { timestamp });
      await expect(report(Action.REGISTER_TX, payload, { timestamp })).to.be.revertedWith("Tx already registered");

      expect(await txRegistry.txCount()).to.equal(1n);
    });

    it("rejects a chain that is not registered", async function () {
      const { report } = await loadFixture(deployFixture);
      const unknown = ethers.keccak256(ethers.toUtf8Bytes("eip155:1"));

      await expect(report(Action.REGISTER_TX, registerPayload(unknown, XDC_TX))).to.be.revertedWith("Chain not registered");
    });

    it("reverts when the receiver does not have RELAYER_ROLE in the registry", async function () {
      const { receiver, txRegistry, report } = await loadFixture(deployFixture);
      await txRegistry.revokeRole(RELAYER_ROLE, await receiver.getAddress());

      await expect(report(Action.REGISTER_TX, registerPayload(XDC_CHAIN, XDC_TX)))
        .to.be.revertedWithCustomError(txRegistry, "AccessControlUnauthorizedAccount")
        .withArgs(await receiver.getAddress(), RELAYER_ROLE);
    });
  });

  describe("UPDATE_TX_STATUS", function () {
    it("updates the status in MultiChainTxRegistry and emits TxStatusUpdatedByWorkflow", async function () {
      const { receiver, txRegistry, report, registeredAt } = await loadFixture(registeredFixture);
      const timestamp = registeredAt + 10n;

      const tx = report(Action.UPDATE_TX_STATUS, statusPayload(1n, TxStatus.CONFIRMED), {
        timestamp,
        metadata: metadata(WORKFLOW_ID, encodeWorkflowName(WORKFLOW_NAME), ethers.ZeroAddress),
      });

      await expect(tx).to.emit(txRegistry, "TxStatusUpdated").withArgs(1n, TxStatus.CONFIRMED);
      await expect(tx).to.emit(receiver, "TxStatusUpdatedByWorkflow").withArgs(1n, TxStatus.CONFIRMED, WORKFLOW_ID, timestamp);

      expect((await txRegistry.getTx(1)).status).to.equal(BigInt(TxStatus.CONFIRMED));
      expect(await receiver.lastStatusUpdateAt(1)).to.equal(timestamp);
    });

    it("accepts successive updates with increasing timestamps", async function () {
      const { txRegistry, report, registeredAt } = await loadFixture(registeredFixture);

      await report(Action.UPDATE_TX_STATUS, statusPayload(1n, TxStatus.CONFIRMED), { timestamp: registeredAt + 1n });
      await report(Action.UPDATE_TX_STATUS, statusPayload(1n, TxStatus.FAILED), { timestamp: registeredAt + 2n });

      expect((await txRegistry.getTx(1)).status).to.equal(BigInt(TxStatus.FAILED));
    });

    it("rejects a replayed or older status report, so a previous status cannot come back", async function () {
      const { receiver, txRegistry, report, registeredAt } = await loadFixture(registeredFixture);

      await report(Action.UPDATE_TX_STATUS, statusPayload(1n, TxStatus.CONFIRMED), { timestamp: registeredAt + 5n });
      await report(Action.UPDATE_TX_STATUS, statusPayload(1n, TxStatus.FAILED), { timestamp: registeredAt + 9n });

      // the first report again (same timestamp as when it was signed)
      await expect(report(Action.UPDATE_TX_STATUS, statusPayload(1n, TxStatus.CONFIRMED), { timestamp: registeredAt + 5n }))
        .to.be.revertedWithCustomError(receiver, "StaleStatusUpdate")
        .withArgs(1n, registeredAt + 5n, registeredAt + 9n);

      // a report with exactly the last accepted timestamp
      await expect(report(Action.UPDATE_TX_STATUS, statusPayload(1n, TxStatus.CONFIRMED), { timestamp: registeredAt + 9n }))
        .to.be.revertedWithCustomError(receiver, "StaleStatusUpdate")
        .withArgs(1n, registeredAt + 9n, registeredAt + 9n);

      expect((await txRegistry.getTx(1)).status).to.equal(BigInt(TxStatus.FAILED));
    });

    it("keeps the timestamps of different transactions apart", async function () {
      const { receiver, report, registeredAt } = await loadFixture(registeredFixture);
      await report(Action.REGISTER_TX, registerPayload(XDC_CHAIN, { ...XDC_TX, txHash: "0xabc" }));

      await report(Action.UPDATE_TX_STATUS, statusPayload(1n, TxStatus.CONFIRMED), { timestamp: registeredAt + 9n });
      // an older timestamp is fine for another transaction
      await expect(
        report(Action.UPDATE_TX_STATUS, statusPayload(2n, TxStatus.FAILED), { timestamp: registeredAt + 3n }),
      ).to.not.revert(ethers);

      expect(await receiver.lastStatusUpdateAt(1)).to.equal(registeredAt + 9n);
      expect(await receiver.lastStatusUpdateAt(2)).to.equal(registeredAt + 3n);
    });

    it("rejects an unknown transaction and does not record its timestamp", async function () {
      const { receiver, report, registeredAt } = await loadFixture(registeredFixture);

      await expect(
        report(Action.UPDATE_TX_STATUS, statusPayload(99n, TxStatus.CONFIRMED), { timestamp: registeredAt + 1n }),
      ).to.be.revertedWith("Unknown tx");
      expect(await receiver.lastStatusUpdateAt(99)).to.equal(0n);
    });
  });

  describe("Report envelope", function () {
    it("rejects a report made for another chain", async function () {
      const { receiver, report, chainId } = await loadFixture(deployFixture);

      await expect(report(Action.REGISTER_TX, registerPayload(XDC_CHAIN, XDC_TX), { targetChainId: 11155111n }))
        .to.be.revertedWithCustomError(receiver, "WrongTargetChain")
        .withArgs(11155111n, chainId);
    });

    it("rejects a timestamp too far in the future, and accepts one inside the tolerance", async function () {
      const { receiver, report } = await loadFixture(deployFixture);
      const skew = await receiver.maxFutureSkew();
      expect(skew).to.equal(300n);

      const now = BigInt(await time.latest());
      await expect(
        report(Action.REGISTER_TX, registerPayload(XDC_CHAIN, XDC_TX), { timestamp: now + skew + 100n }),
      ).to.be.revertedWithCustomError(receiver, "TimestampInFuture");

      await expect(
        report(Action.REGISTER_TX, registerPayload(XDC_CHAIN, XDC_TX), { timestamp: now + 60n }),
      ).to.not.revert(ethers);
    });

    it("rejects an unknown action", async function () {
      const { report } = await loadFixture(deployFixture);
      // 7 is outside the Action enum: the ABI decoder reverts
      await expect(report(7, registerPayload(XDC_CHAIN, XDC_TX))).to.be.revertedWithoutReason(ethers);
    });

    it("rejects a payload that does not match the action", async function () {
      const { report } = await loadFixture(deployFixture);
      await expect(report(Action.REGISTER_TX, statusPayload(1n, TxStatus.CONFIRMED))).to.be.revertedWithoutReason(ethers);
    });

    it("rejects a report that is not an encoded Report", async function () {
      const { receiver, forwarder } = await loadFixture(deployFixture);
      await expect(receiver.connect(forwarder).onReport(NO_METADATA, "0x1234")).to.be.revertedWithoutReason(ethers);
    });
  });

  describe("Workflow identity checks", function () {
    const payload = registerPayload(XDC_CHAIN, XDC_TX);

    it("accepts only the expected workflow id", async function () {
      const { receiver, report } = await loadFixture(deployFixture);

      await expect(receiver.setExpectedWorkflowId(WORKFLOW_ID))
        .to.emit(receiver, "ExpectedWorkflowIdUpdated")
        .withArgs(ethers.ZeroHash, WORKFLOW_ID);
      expect(await receiver.getExpectedWorkflowId()).to.equal(WORKFLOW_ID);

      await expect(report(Action.REGISTER_TX, payload, { metadata: metadata(OTHER_WORKFLOW_ID, "0x" + "00".repeat(10), ethers.ZeroAddress) }))
        .to.be.revertedWithCustomError(receiver, "InvalidWorkflowId")
        .withArgs(OTHER_WORKFLOW_ID, WORKFLOW_ID);

      await expect(
        report(Action.REGISTER_TX, payload, { metadata: metadata(WORKFLOW_ID, "0x" + "00".repeat(10), ethers.ZeroAddress) }),
      ).to.not.revert(ethers);
    });

    it("rejects a report without metadata once a workflow id is expected", async function () {
      const { receiver, report } = await loadFixture(deployFixture);
      await receiver.setExpectedWorkflowId(WORKFLOW_ID);

      // this is why the checks must stay off while simulating: the mock forwarder sends no metadata
      await expect(report(Action.REGISTER_TX, payload))
        .to.be.revertedWithCustomError(receiver, "InvalidWorkflowId")
        .withArgs(ethers.ZeroHash, WORKFLOW_ID);
    });

    it("accepts only workflows of the expected author", async function () {
      const { receiver, report, workflowOwner, other } = await loadFixture(deployFixture);

      await expect(receiver.setExpectedAuthor(workflowOwner.address))
        .to.emit(receiver, "ExpectedAuthorUpdated")
        .withArgs(ethers.ZeroAddress, workflowOwner.address);

      await expect(report(Action.REGISTER_TX, payload, { metadata: metadata(WORKFLOW_ID, "0x" + "00".repeat(10), other.address) }))
        .to.be.revertedWithCustomError(receiver, "InvalidAuthor")
        .withArgs(other.address, workflowOwner.address);

      await expect(
        report(Action.REGISTER_TX, payload, { metadata: metadata(WORKFLOW_ID, "0x" + "00".repeat(10), workflowOwner.address) }),
      ).to.not.revert(ethers);
    });

    it("stores the workflow name as the first 10 hex characters of its sha256", async function () {
      const { receiver } = await loadFixture(deployFixture);
      const encoded = encodeWorkflowName(WORKFLOW_NAME);

      await expect(receiver.setExpectedWorkflowName(WORKFLOW_NAME))
        .to.emit(receiver, "ExpectedWorkflowNameUpdated")
        .withArgs("0x" + "00".repeat(10), encoded);
      expect(await receiver.getExpectedWorkflowName()).to.equal(encoded);

      // an empty name disables the check
      await receiver.setExpectedWorkflowName("");
      expect(await receiver.getExpectedWorkflowName()).to.equal("0x" + "00".repeat(10));
    });

    it("accepts the workflow name only together with the author", async function () {
      const { receiver, report, workflowOwner } = await loadFixture(deployFixture);
      const name = encodeWorkflowName(WORKFLOW_NAME);
      const good = metadata(WORKFLOW_ID, name, workflowOwner.address);

      await receiver.setExpectedWorkflowName(WORKFLOW_NAME);

      // name without author: refused, because a name alone can be collided
      await expect(report(Action.REGISTER_TX, payload, { metadata: good }))
        .to.be.revertedWithCustomError(receiver, "WorkflowNameRequiresAuthorValidation");

      await receiver.setExpectedAuthor(workflowOwner.address);

      await expect(
        report(Action.REGISTER_TX, payload, { metadata: metadata(WORKFLOW_ID, encodeWorkflowName("another-name"), workflowOwner.address) }),
      )
        .to.be.revertedWithCustomError(receiver, "InvalidWorkflowName")
        .withArgs(encodeWorkflowName("another-name"), name);

      await expect(report(Action.REGISTER_TX, payload, { metadata: good })).to.not.revert(ethers);
    });

    it("disables a check when it is set back to zero", async function () {
      const { receiver, report } = await loadFixture(deployFixture);
      await receiver.setExpectedWorkflowId(WORKFLOW_ID);
      await receiver.setExpectedWorkflowId(ethers.ZeroHash);

      await expect(report(Action.REGISTER_TX, payload)).to.not.revert(ethers);
    });
  });

  describe("Configuration", function () {
    it("lets the admin change the forwarder", async function () {
      const { receiver, forwarder, other, chainId } = await loadFixture(deployFixture);

      await expect(receiver.setForwarderAddress(other.address))
        .to.emit(receiver, "ForwarderAddressUpdated")
        .withArgs(forwarder.address, other.address);
      expect(await receiver.getForwarderAddress()).to.equal(other.address);

      // the old forwarder is no longer accepted, the new one is
      const encoded = encodeReport(chainId, BigInt(await time.latest()), Action.REGISTER_TX, registerPayload(XDC_CHAIN, XDC_TX));
      await expect(receiver.connect(forwarder).onReport(NO_METADATA, encoded))
        .to.be.revertedWithCustomError(receiver, "InvalidSender")
        .withArgs(forwarder.address, other.address);
      await expect(receiver.connect(other).onReport(NO_METADATA, encoded)).to.not.revert(ethers);
    });

    it("never accepts a zero forwarder, which would switch the sender check off", async function () {
      const { receiver, forwarder } = await loadFixture(deployFixture);

      await expect(receiver.setForwarderAddress(ethers.ZeroAddress)).to.be.revertedWithCustomError(receiver, "InvalidForwarderAddress");
      expect(await receiver.getForwarderAddress()).to.equal(forwarder.address);
    });

    it("rejects configuration changes from non-admins, including the forwarder", async function () {
      const { receiver, forwarder, other } = await loadFixture(deployFixture);

      for (const account of [forwarder, other]) {
        const r = receiver.connect(account);
        await expect(r.setForwarderAddress(other.address))
          .to.be.revertedWithCustomError(receiver, "AccessControlUnauthorizedAccount")
          .withArgs(account.address, ADMIN_ROLE);
        await expect(r.setExpectedWorkflowId(WORKFLOW_ID))
          .to.be.revertedWithCustomError(receiver, "AccessControlUnauthorizedAccount")
          .withArgs(account.address, ADMIN_ROLE);
        await expect(r.setExpectedAuthor(other.address))
          .to.be.revertedWithCustomError(receiver, "AccessControlUnauthorizedAccount")
          .withArgs(account.address, ADMIN_ROLE);
        await expect(r.setExpectedWorkflowName(WORKFLOW_NAME))
          .to.be.revertedWithCustomError(receiver, "AccessControlUnauthorizedAccount")
          .withArgs(account.address, ADMIN_ROLE);
      }
    });

    it("starts with a tolerance of 5 minutes for future timestamps", async function () {
      const { receiver } = await loadFixture(deployFixture);

      expect(await receiver.DEFAULT_MAX_FUTURE_SKEW()).to.equal(300n);
      expect(await receiver.maxFutureSkew()).to.equal(300n);
    });

    it("lets the admin change the tolerance, emitting MaxFutureSkewUpdated", async function () {
      const { receiver } = await loadFixture(deployFixture);

      await expect(receiver.setMaxFutureSkew(60)).to.emit(receiver, "MaxFutureSkewUpdated").withArgs(300n, 60n);
      expect(await receiver.maxFutureSkew()).to.equal(60n);

      // the default of new deployments does not change
      expect(await receiver.DEFAULT_MAX_FUTURE_SKEW()).to.equal(300n);
    });

    it("applies the new tolerance to the next reports", async function () {
      const { receiver, report } = await loadFixture(deployFixture);
      const payload = registerPayload(XDC_CHAIN, XDC_TX);

      // 10 minutes ahead: refused with the default of 5 minutes
      const ahead = 600n;
      await expect(
        report(Action.REGISTER_TX, payload, { timestamp: BigInt(await time.latest()) + ahead }),
      ).to.be.revertedWithCustomError(receiver, "TimestampInFuture");

      // accepted once the tolerance is raised to 1 hour
      await receiver.setMaxFutureSkew(3600);
      await expect(
        report(Action.REGISTER_TX, payload, { timestamp: BigInt(await time.latest()) + ahead }),
      ).to.not.revert(ethers);
    });

    it("accepts no timestamp ahead of the block when the tolerance is zero", async function () {
      const { receiver, report } = await loadFixture(deployFixture);
      await receiver.setMaxFutureSkew(0);

      // the block of the report is mined after time.latest(), so +3600 is well ahead of it
      await expect(
        report(Action.REGISTER_TX, registerPayload(XDC_CHAIN, XDC_TX), { timestamp: BigInt(await time.latest()) + 3600n }),
      ).to.be.revertedWithCustomError(receiver, "TimestampInFuture");

      // a timestamp at or before the block is still accepted
      await expect(report(Action.REGISTER_TX, registerPayload(XDC_CHAIN, XDC_TX))).to.not.revert(ethers);
    });

    it("rejects a tolerance change from non-admins", async function () {
      const { receiver, forwarder, other } = await loadFixture(deployFixture);

      for (const account of [forwarder, other]) {
        await expect(receiver.connect(account).setMaxFutureSkew(0))
          .to.be.revertedWithCustomError(receiver, "AccessControlUnauthorizedAccount")
          .withArgs(account.address, ADMIN_ROLE);
      }
      expect(await receiver.maxFutureSkew()).to.equal(300n);
    });

    it("keeps the admin protected, like the other contracts", async function () {
      const { receiver, owner } = await loadFixture(deployFixture);

      await expect(receiver.renounceRole(ADMIN_ROLE, owner.address)).to.be.revertedWith("Admin cannot renounce");
      await expect(receiver.revokeRole(ADMIN_ROLE, owner.address)).to.be.revertedWith("Admin cannot revoke itself");
    });
  });
});
