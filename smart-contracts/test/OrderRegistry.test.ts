import { expect } from "chai";
import {
  ethers,
  loadFixture,
  abi,
  ZERO_HASH,
  ADMIN_ROLE,
  RELAYER_ROLE,
  OPERATOR_ROLE,
  TxStatus,
  OrderProgress,
  Disposition,
  Role,
  keyOf,
  key,
  CHAINS,
  XDC_CHAIN,
  XRPL_CHAIN,
  STELLAR_CHAIN,
  STABLE,
  stableKeyOf,
  FUND,
  FUND_CREATION_TX,
  FUND2,
  ORDER,
  SOURCE_CONTROLLER,
  DESTINATION_OWNER,
  DESTINATION2_OWNER,
  INTENT,
  TRANSFER_INFO,
  SOURCE_TX,
  LOCK_INFO,
  LOCK_TX,
  DELIVERY_INFO,
  DESTINATION_TX,
  ORDER2,
  INTENT2,
  DELIVERY2_INFO,
  DESTINATION2_TX,
  baseFixture,
  deployFixture,
  fundFixture,
  orderFixture,
  txsFixture,
} from "./helpers/fundOrder.js";

describe("OrderRegistry", function () {
  describe("Deployment", function () {
    it("stores the MultiChainTxRegistry, the FundRegistry and the owner", async function () {
      const { registry, funds, txRegistry, owner } = await loadFixture(deployFixture);
      expect(await registry.txRegistry()).to.equal(await txRegistry.getAddress());
      expect(await registry.fundRegistry()).to.equal(await funds.getAddress());
      expect(await registry.hasRole(ADMIN_ROLE, owner.address)).to.equal(true);
    });

    it("rejects a zero registry address", async function () {
      const { funds } = await loadFixture(baseFixture);
      await expect(
        ethers.deployContract("OrderRegistry", [ethers.ZeroAddress, await funds.getAddress()]),
      ).to.be.revertedWith("Zero registry");
    });

    it("rejects a zero fund registry address", async function () {
      const { txRegistry } = await loadFixture(baseFixture);
      await expect(
        ethers.deployContract("OrderRegistry", [await txRegistry.getAddress(), ethers.ZeroAddress]),
      ).to.be.revertedWith("Zero fund registry");
    });

    it("rejects a FundRegistry that uses another MultiChainTxRegistry", async function () {
      const { funds } = await loadFixture(baseFixture);
      const otherTxRegistry = await ethers.deployContract("MultiChainTxRegistry");
      await otherTxRegistry.waitForDeployment();

      await expect(
        ethers.deployContract("OrderRegistry", [await otherTxRegistry.getAddress(), await funds.getAddress()]),
      ).to.be.revertedWith("Registry mismatch");
    });

    it("has its own operators, separate from the FundRegistry", async function () {
      const { registry, funds, other } = await loadFixture(baseFixture);

      await registry.grantRole(OPERATOR_ROLE, other.address);
      expect(await registry.hasRole(OPERATOR_ROLE, other.address)).to.equal(true);
      expect(await funds.hasRole(OPERATOR_ROLE, other.address)).to.equal(false);
    });
  });

  describe("Admin role (AdminProtected)", function () {
    it("gives DEFAULT_ADMIN_ROLE to the deployer only", async function () {
      const { registry, owner, other } = await loadFixture(deployFixture);

      expect(await registry.DEFAULT_ADMIN_ROLE()).to.equal(ADMIN_ROLE);
      expect(await registry.hasRole(ADMIN_ROLE, owner.address)).to.equal(true);
      expect(await registry.hasRole(ADMIN_ROLE, other.address)).to.equal(false);
    });

    it("lets an admin grant the admin role to another account", async function () {
      const { registry, owner, other } = await loadFixture(deployFixture);

      await expect(registry.grantRole(ADMIN_ROLE, other.address))
        .to.emit(registry, "RoleGranted")
        .withArgs(ADMIN_ROLE, other.address, owner.address);

      // both are admins now, and the new one manages roles
      expect(await registry.hasRole(ADMIN_ROLE, owner.address)).to.equal(true);
      expect(await registry.hasRole(ADMIN_ROLE, other.address)).to.equal(true);
      await expect(registry.connect(other).grantRole(OPERATOR_ROLE, owner.address)).to.not.revert(ethers);
    });

    it("hands the contract over when the new admin revokes the old one", async function () {
      const { registry, owner, other } = await loadFixture(deployFixture);
      await registry.grantRole(ADMIN_ROLE, other.address);

      await expect(registry.connect(other).revokeRole(ADMIN_ROLE, owner.address))
        .to.emit(registry, "RoleRevoked")
        .withArgs(ADMIN_ROLE, owner.address, other.address);

      expect(await registry.hasRole(ADMIN_ROLE, owner.address)).to.equal(false);
      await expect(registry.connect(owner).grantRole(OPERATOR_ROLE, owner.address))
        .to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount")
        .withArgs(owner.address, ADMIN_ROLE);
    });

    it("does not let an admin renounce the admin role", async function () {
      const { registry, owner, other } = await loadFixture(deployFixture);

      await expect(registry.renounceRole(ADMIN_ROLE, owner.address)).to.be.revertedWith("Admin cannot renounce");

      // not even when another admin exists
      await registry.grantRole(ADMIN_ROLE, other.address);
      await expect(registry.renounceRole(ADMIN_ROLE, owner.address)).to.be.revertedWith("Admin cannot renounce");

      expect(await registry.hasRole(ADMIN_ROLE, owner.address)).to.equal(true);
    });

    it("does not let an admin revoke its own admin role", async function () {
      const { registry, owner, other } = await loadFixture(deployFixture);

      await expect(registry.revokeRole(ADMIN_ROLE, owner.address)).to.be.revertedWith("Admin cannot revoke itself");

      // not even when another admin exists: only the other admin can do it
      await registry.grantRole(ADMIN_ROLE, other.address);
      await expect(registry.revokeRole(ADMIN_ROLE, owner.address)).to.be.revertedWith("Admin cannot revoke itself");
      await expect(registry.connect(other).revokeRole(ADMIN_ROLE, other.address)).to.be.revertedWith("Admin cannot revoke itself");

      expect(await registry.hasRole(ADMIN_ROLE, owner.address)).to.equal(true);
      expect(await registry.hasRole(ADMIN_ROLE, other.address)).to.equal(true);
    });

    it("still lets an account renounce a role that is not the admin role", async function () {
      const { registry, other } = await loadFixture(deployFixture);
      await registry.grantRole(OPERATOR_ROLE, other.address);

      await expect(registry.connect(other).renounceRole(OPERATOR_ROLE, other.address))
        .to.emit(registry, "RoleRevoked")
        .withArgs(OPERATOR_ROLE, other.address, other.address);
      expect(await registry.hasRole(OPERATOR_ROLE, other.address)).to.equal(false);
    });

    it("lets an admin revoke a non-admin role from itself", async function () {
      const { registry, owner } = await loadFixture(deployFixture);
      await registry.grantRole(OPERATOR_ROLE, owner.address);

      await expect(registry.revokeRole(OPERATOR_ROLE, owner.address)).to.not.revert(ethers);
      expect(await registry.hasRole(OPERATOR_ROLE, owner.address)).to.equal(false);
    });

    it("rejects role management from non-admins", async function () {
      const { registry, owner, other } = await loadFixture(deployFixture);

      await expect(registry.connect(other).grantRole(ADMIN_ROLE, other.address))
        .to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount")
        .withArgs(other.address, ADMIN_ROLE);
      await expect(registry.connect(other).revokeRole(ADMIN_ROLE, owner.address))
        .to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount")
        .withArgs(other.address, ADMIN_ROLE);
      await expect(registry.connect(other).grantRole(OPERATOR_ROLE, other.address))
        .to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount")
        .withArgs(other.address, ADMIN_ROLE);
    });
  });

  describe("OPERATOR_ROLE", function () {
    it("has the id keccak256(\"OPERATOR_ROLE\")", async function () {
      const { registry } = await loadFixture(deployFixture);
      expect(await registry.OPERATOR_ROLE()).to.equal(OPERATOR_ROLE);
    });

    it("is granted and revoked by the admin, emitting RoleGranted and RoleRevoked", async function () {
      const { registry, owner, other } = await loadFixture(deployFixture);

      await expect(registry.grantRole(OPERATOR_ROLE, other.address))
        .to.emit(registry, "RoleGranted")
        .withArgs(OPERATOR_ROLE, other.address, owner.address);
      expect(await registry.hasRole(OPERATOR_ROLE, other.address)).to.equal(true);

      await expect(registry.revokeRole(OPERATOR_ROLE, other.address))
        .to.emit(registry, "RoleRevoked")
        .withArgs(OPERATOR_ROLE, other.address, owner.address);
      expect(await registry.hasRole(OPERATOR_ROLE, other.address)).to.equal(false);
    });

    it("is not held by the admin unless it is granted", async function () {
      const { registry, owner } = await loadFixture(deployFixture);
      // the admin manages roles and order tx roles, but does not load data
      expect(await registry.hasRole(OPERATOR_ROLE, owner.address)).to.equal(false);
    });

    it("cannot be granted by an account that only has OPERATOR_ROLE", async function () {
      const { registry, other } = await loadFixture(deployFixture);
      await registry.grantRole(OPERATOR_ROLE, other.address);

      await expect(registry.connect(other).grantRole(OPERATOR_ROLE, other.address))
        .to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount")
        .withArgs(other.address, ADMIN_ROLE);
    });
  });

  describe("Order tx roles", function () {
    const REFUND = ethers.encodeBytes32String("REFUND");

    it("starts with TRANSFER, LOCK and DELIVERY registered", async function () {
      const { registry } = await loadFixture(baseFixture);

      const roles = await registry.listOrderTxRoles();
      expect(roles.map((r) => r.role)).to.deep.equal([Role.TRANSFER, Role.LOCK, Role.DELIVERY]);
      expect(roles.map((r) => r.onDestinationChain)).to.deep.equal([false, false, true]);
      expect(roles.map((r) => r.active)).to.deep.equal([true, true, true]);
      expect(roles[0].description).to.equal("Cash token sent to the order escrow");
    });

    it("lets the owner register a new role and emits OrderTxRoleRegistered", async function () {
      const { registry } = await loadFixture(baseFixture);

      await expect(registry.registerOrderTxRole(REFUND, "Cash token returned to the fund", false))
        .to.emit(registry, "OrderTxRoleRegistered")
        .withArgs(REFUND, "Cash token returned to the fund", false);

      const roles = await registry.listOrderTxRoles();
      expect(roles.length).to.equal(4);
      expect(roles[3].role).to.equal(REFUND);
      expect(roles[3].description).to.equal("Cash token returned to the fund");
      expect(roles[3].onDestinationChain).to.equal(false);
      expect(roles[3].active).to.equal(true);
    });

    it("records a transaction with a new source-chain role", async function () {
      const { registry, txRegistry, operator } = await loadFixture(orderFixture);
      await registry.registerOrderTxRole(REFUND, "Cash token returned to the fund", false);

      await registry.connect(operator).recordOrderTx(ORDER.orderId, REFUND, LOCK_INFO, LOCK_TX, []);

      const [orderTx] = await registry.getOrderTxs(ORDER.orderId);
      expect(orderTx.role).to.equal(REFUND);
      expect(orderTx.chainId).to.equal(XDC_CHAIN);
      expect((await txRegistry.getTx(1)).chainId).to.equal(XDC_CHAIN);
    });

    it("records a transaction with a new destination-chain role", async function () {
      const { registry, txRegistry, operator } = await loadFixture(orderFixture);
      const CLAWBACK = ethers.encodeBytes32String("CLAWBACK");
      await registry.registerOrderTxRole(CLAWBACK, "Asset taken back on the destination chain", true);

      await registry.connect(operator).recordOrderTx(ORDER.orderId, CLAWBACK, DELIVERY_INFO, DESTINATION_TX, []);

      const [orderTx] = await registry.getOrderTxs(ORDER.orderId);
      expect(orderTx.role).to.equal(CLAWBACK);
      expect(orderTx.chainId).to.equal(XRPL_CHAIN);
      expect((await txRegistry.getTx(1)).chainId).to.equal(XRPL_CHAIN);
    });

    it("rejects an empty role and a duplicated role", async function () {
      const { registry } = await loadFixture(baseFixture);

      await expect(registry.registerOrderTxRole(ZERO_HASH, "", false)).to.be.revertedWith("Empty role");
      await expect(registry.registerOrderTxRole(Role.LOCK, "again", true)).to.be.revertedWith("Role already registered");
    });

    it("rejects recording a transaction with an unknown role", async function () {
      const { registry, operator } = await loadFixture(orderFixture);

      await expect(
        registry.connect(operator).recordOrderTx(ORDER.orderId, REFUND, LOCK_INFO, LOCK_TX, []),
      ).to.be.revertedWith("Unknown role");
      await expect(
        registry.connect(operator).recordOrderTx(ORDER.orderId, ZERO_HASH, LOCK_INFO, LOCK_TX, []),
      ).to.be.revertedWith("Unknown role");
    });

    it("deprecates and reactivates a role, emitting OrderTxRoleStatusUpdated", async function () {
      const { registry, operator } = await loadFixture(txsFixture);

      await expect(registry.setOrderTxRoleActive(Role.LOCK, false))
        .to.emit(registry, "OrderTxRoleStatusUpdated")
        .withArgs(Role.LOCK, false);
      expect((await registry.listOrderTxRoles())[1].active).to.equal(false);

      await expect(
        registry.connect(operator).recordOrderTx(ORDER.orderId, Role.LOCK, LOCK_INFO, LOCK_TX, []),
      ).to.be.revertedWith("Role deprecated");

      // the other roles and the transactions already recorded are untouched
      expect(await registry.getOrderTxCount(ORDER.orderId)).to.equal(2n);
      expect((await registry.listOrderTxRoles())[0].active).to.equal(true);

      await registry.setOrderTxRoleActive(Role.LOCK, true);
      await expect(
        registry.connect(operator).recordOrderTx(ORDER.orderId, Role.LOCK, LOCK_INFO, LOCK_TX, []),
      ).to.not.revert(ethers);
    });

    it("keeps the role of transactions recorded before it was deprecated", async function () {
      const { registry } = await loadFixture(txsFixture);
      await registry.setOrderTxRoleActive(Role.TRANSFER, false);

      const [orderTx, txData] = await registry.getOrderTx(ORDER.orderId, 0);
      expect(orderTx.role).to.equal(Role.TRANSFER);
      expect(txData.id).to.equal(1n);
    });

    it("rejects setOrderTxRoleActive for an unknown role", async function () {
      const { registry } = await loadFixture(baseFixture);
      await expect(registry.setOrderTxRoleActive(REFUND, false)).to.be.revertedWith("Unknown role");
    });

    it("rejects non-admin callers, including operators", async function () {
      const { registry, operator, other } = await loadFixture(baseFixture);

      await expect(registry.connect(operator).registerOrderTxRole(REFUND, "", false))
        .to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount")
        .withArgs(operator.address, ADMIN_ROLE);
      await expect(registry.connect(other).setOrderTxRoleActive(Role.LOCK, false))
        .to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount")
        .withArgs(other.address, ADMIN_ROLE);
    });
  });

  describe("registerOrder", function () {
    it("stores the order and the intent and emits OrderRegistered", async function () {
      const { registry, operator, fundKey } = await loadFixture(fundFixture);
      const orderKey = keyOf(ORDER.orderId);

      await expect(registry.connect(operator).registerOrder(ORDER.orderId, FUND.fundId, ORDER.intentHash, INTENT, ORDER.createdAt))
        .to.emit(registry, "OrderRegistered")
        .withArgs(orderKey, fundKey, ORDER.orderId, ORDER.intentHash);

      const o = await registry.getOrder(ORDER.orderId);
      expect(o.orderKey).to.equal(orderKey);
      expect(o.orderId).to.equal(ORDER.orderId);
      expect(o.fundKey).to.equal(fundKey);
      expect(o.intentHash).to.equal(ORDER.intentHash);
      expect(o.progress).to.equal(BigInt(OrderProgress.AWAITING_ORIGIN));
      expect(o.version).to.equal(0n);
      expect(o.createdAt).to.equal(ORDER.createdAt);
      expect(o.updatedAt).to.equal(ORDER.createdAt);

      const i = await registry.getOrderIntent(ORDER.orderId);
      expect(i.orderId).to.equal(INTENT.orderId);
      expect(i.cashToken).to.equal(INTENT.cashToken);
      expect(i.validUntil).to.equal(INTENT.validUntil);
      expect(i.beneficiary).to.equal(INTENT.beneficiary);
      expect(i.sourceChainId).to.equal(INTENT.sourceChainId);
      expect(i.sourceAccount).to.equal(INTENT.sourceAccount);
      expect(i.destinationChainId).to.equal(INTENT.destinationChainId);
    });

    it("returns the orderKey", async function () {
      const { registry, operator, fundKey } = await loadFixture(fundFixture);
      const returned = await registry.connect(operator).registerOrder.staticCall(ORDER.orderId, FUND.fundId, ORDER.intentHash, INTENT, ORDER.createdAt);
      expect(returned).to.equal(keyOf(ORDER.orderId));
    });

    it("indexes the order by fund and by intentHash", async function () {
      const { registry, operator, fundKey } = await loadFixture(fundFixture);
      await registry.connect(operator).registerOrder(ORDER.orderId, FUND.fundId, ORDER.intentHash, INTENT, ORDER.createdAt);

      expect(await registry.getOrdersByFund(FUND.fundId)).to.deep.equal([ORDER.orderId]);
      expect(await registry.orderKeyByIntentHash(ORDER.intentHash)).to.equal(keyOf(ORDER.orderId));
    });

    it("starts with no transactions", async function () {
      const { registry } = await loadFixture(orderFixture);

      expect(await registry.getOrderTxCount(ORDER.orderId)).to.equal(0n);
      expect(await registry.getOrderTxs(ORDER.orderId)).to.deep.equal([]);
    });

    it("rejects an unknown fund", async function () {
      const { registry, operator } = await loadFixture(fundFixture);
      await expect(
        registry.connect(operator).registerOrder(ORDER.orderId, "nope", ORDER.intentHash, INTENT, ORDER.createdAt),
      ).to.be.revertedWith("Unknown fund");
    });

    it("rejects a duplicated order", async function () {
      const { registry, operator, fundKey } = await loadFixture(orderFixture);
      await expect(
        registry.connect(operator).registerOrder(ORDER.orderId.toUpperCase(), FUND.fundId, "0x" + "22".repeat(32), INTENT, ORDER.createdAt),
      ).to.be.revertedWith("Order already registered");
    });

    it("rejects an intent whose orderId differs from the order", async function () {
      const { registry, operator } = await loadFixture(fundFixture);

      await expect(
        registry.connect(operator).registerOrder(ORDER.orderId, FUND.fundId, ORDER.intentHash, { ...INTENT, orderId: "another-order" }, ORDER.createdAt),
      ).to.be.revertedWith("Intent orderId mismatch");
      await expect(
        registry.connect(operator).registerOrder(ORDER.orderId, FUND.fundId, ORDER.intentHash, { ...INTENT, orderId: "" }, ORDER.createdAt),
      ).to.be.revertedWith("Empty id");
    });

    it("accepts an intent orderId that only differs in case or whitespace", async function () {
      const { registry, operator } = await loadFixture(fundFixture);
      const intent = { ...INTENT, orderId: " " + ORDER.orderId.toUpperCase() };

      await registry.connect(operator).registerOrder(ORDER.orderId, FUND.fundId, ORDER.intentHash, intent, ORDER.createdAt);

      // the intent keeps the text it was sent with; the transactions get the order's orderId
      expect((await registry.getOrderIntent(ORDER.orderId)).orderId).to.equal(intent.orderId);

      await registry.connect(operator).recordOrderTx(ORDER.orderId, Role.TRANSFER, TRANSFER_INFO, SOURCE_TX, []);
      expect((await registry.getOrderTxs(ORDER.orderId))[0].orderId).to.equal(ORDER.orderId);
    });

    it("rejects an empty intentHash", async function () {
      const { registry, operator, fundKey } = await loadFixture(fundFixture);
      await expect(
        registry.connect(operator).registerOrder(ORDER.orderId, FUND.fundId, ZERO_HASH, INTENT, ORDER.createdAt),
      ).to.be.revertedWith("Empty intentHash");
    });

    it("rejects an intentHash already used by another order", async function () {
      const { registry, operator, fundKey } = await loadFixture(orderFixture);
      await expect(
        registry.connect(operator).registerOrder("another-order", FUND.fundId, ORDER.intentHash, INTENT, ORDER.createdAt),
      ).to.be.revertedWith("Intent already used");
    });

    it("rejects an intent whose source chain differs from the fund chain", async function () {
      const { registry, operator, fundKey } = await loadFixture(fundFixture);
      await expect(
        registry.connect(operator).registerOrder(ORDER.orderId, FUND.fundId, ORDER.intentHash, { ...INTENT, sourceChainId: XRPL_CHAIN }, ORDER.createdAt),
      ).to.be.revertedWith("Source chain != fund chain");
    });

    it("rejects an intent whose source account differs from the fund contract", async function () {
      const { registry, operator, fundKey } = await loadFixture(fundFixture);
      await expect(
        registry.connect(operator).registerOrder(ORDER.orderId, FUND.fundId, ORDER.intentHash, { ...INTENT, sourceAccount: INTENT.beneficiary }, ORDER.createdAt),
      ).to.be.revertedWith("Source account != fund contract");
    });

    it("rejects an intent whose cash token differs from the fund stable", async function () {
      const { registry, operator, fundKey } = await loadFixture(fundFixture);
      await expect(
        registry.connect(operator).registerOrder(ORDER.orderId, FUND.fundId, ORDER.intentHash, { ...INTENT, cashToken: INTENT.beneficiary }, ORDER.createdAt),
      ).to.be.revertedWith("Cash token != fund stable");
    });

    it("rejects an unregistered destination chain", async function () {
      const { registry, operator, fundKey } = await loadFixture(fundFixture);
      await expect(
        registry.connect(operator).registerOrder(ORDER.orderId, FUND.fundId, ORDER.intentHash, { ...INTENT, destinationChainId: keyOf("solana:devnet") }, ORDER.createdAt),
      ).to.be.revertedWith("Chain not registered");
    });

    it("rejects non-operator callers", async function () {
      const { registry, other, fundKey } = await loadFixture(fundFixture);
      await expect(
        registry.connect(other).registerOrder(ORDER.orderId, FUND.fundId, ORDER.intentHash, INTENT, ORDER.createdAt),
      ).to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
    });
  });

  describe("Order tx dispositions", function () {
    const REFUNDED = ethers.encodeBytes32String("REFUNDED");

    it("starts with LOCKED and DELIVERED registered", async function () {
      const { registry } = await loadFixture(baseFixture);

      const dispositions = await registry.listOrderTxDispositions();
      expect(dispositions.map((d) => d.disposition)).to.deep.equal([Disposition.LOCKED, Disposition.DELIVERED]);
      expect(dispositions.map((d) => d.active)).to.deep.equal([true, true]);
      expect(dispositions[0].description).to.equal("Cash token locked in the order escrow");
    });

    it("lets the admin register a new disposition and emits OrderTxDispositionRegistered", async function () {
      const { registry } = await loadFixture(baseFixture);

      await expect(registry.registerOrderTxDisposition(REFUNDED, "Cash token returned to the fund"))
        .to.emit(registry, "OrderTxDispositionRegistered")
        .withArgs(REFUNDED, "Cash token returned to the fund");

      const dispositions = await registry.listOrderTxDispositions();
      expect(dispositions.length).to.equal(3);
      expect(dispositions[2].disposition).to.equal(REFUNDED);
      expect(dispositions[2].description).to.equal("Cash token returned to the fund");
      expect(dispositions[2].active).to.equal(true);
    });

    it("records and updates a transaction with a new disposition", async function () {
      const { registry, operator } = await loadFixture(orderFixture);
      await registry.registerOrderTxDisposition(REFUNDED, "Cash token returned to the fund");

      await registry.connect(operator).recordOrderTx(ORDER.orderId, Role.TRANSFER, { ...TRANSFER_INFO, disposition: REFUNDED }, SOURCE_TX, []);
      expect((await registry.getOrderTxs(ORDER.orderId))[0].disposition).to.equal(REFUNDED);

      await registry.connect(operator).updateOrderTxEvidence(ORDER.orderId, 0, Disposition.LOCKED);
      await registry.connect(operator).updateOrderTxEvidence(ORDER.orderId, 0, REFUNDED);
      expect((await registry.getOrderTxs(ORDER.orderId))[0].disposition).to.equal(REFUNDED);
    });

    it("always accepts no disposition, which is bytes32(0)", async function () {
      const { registry, operator } = await loadFixture(txsFixture);

      await expect(
        registry.connect(operator).recordOrderTx(ORDER.orderId, Role.LOCK, { ...LOCK_INFO, disposition: ZERO_HASH }, LOCK_TX, []),
      ).to.not.revert(ethers);
      await expect(registry.connect(operator).updateOrderTxEvidence(ORDER.orderId, 0, ZERO_HASH)).to.not.revert(ethers);

      expect((await registry.getOrderTxs(ORDER.orderId))[0].disposition).to.equal(ZERO_HASH);
    });

    it("rejects an empty disposition and a duplicated one", async function () {
      const { registry } = await loadFixture(baseFixture);

      await expect(registry.registerOrderTxDisposition(ZERO_HASH, "")).to.be.revertedWith("Empty disposition");
      await expect(registry.registerOrderTxDisposition(Disposition.LOCKED, "again")).to.be.revertedWith("Disposition already registered");
    });

    it("rejects recording or updating a transaction with an unknown disposition", async function () {
      const { registry, txRegistry, operator } = await loadFixture(txsFixture);

      await expect(
        registry.connect(operator).recordOrderTx(ORDER.orderId, Role.LOCK, { ...LOCK_INFO, disposition: REFUNDED }, LOCK_TX, []),
      ).to.be.revertedWith("Unknown disposition");
      await expect(
        registry.connect(operator).updateOrderTxEvidence(ORDER.orderId, 0, REFUNDED),
      ).to.be.revertedWith("Unknown disposition");

      // nothing was registered or changed
      expect(await registry.getOrderTxCount(ORDER.orderId)).to.equal(2n);
      expect(await txRegistry.txCount()).to.equal(2n);
      expect((await registry.getOrderTxs(ORDER.orderId))[0].disposition).to.equal(Disposition.LOCKED);
    });

    it("deprecates and reactivates a disposition, emitting OrderTxDispositionStatusUpdated", async function () {
      const { registry, operator } = await loadFixture(txsFixture);

      await expect(registry.setOrderTxDispositionActive(Disposition.DELIVERED, false))
        .to.emit(registry, "OrderTxDispositionStatusUpdated")
        .withArgs(Disposition.DELIVERED, false);
      expect((await registry.listOrderTxDispositions())[1].active).to.equal(false);

      await expect(
        registry.connect(operator).updateOrderTxEvidence(ORDER.orderId, 0, Disposition.DELIVERED),
      ).to.be.revertedWith("Disposition deprecated");
      await expect(
        registry.connect(operator).recordOrderTx(ORDER.orderId, Role.LOCK, { ...LOCK_INFO, disposition: Disposition.DELIVERED }, LOCK_TX, []),
      ).to.be.revertedWith("Disposition deprecated");

      // the other disposition still works
      await expect(registry.connect(operator).updateOrderTxEvidence(ORDER.orderId, 1, Disposition.LOCKED)).to.not.revert(ethers);

      await registry.setOrderTxDispositionActive(Disposition.DELIVERED, true);
      await expect(
        registry.connect(operator).updateOrderTxEvidence(ORDER.orderId, 0, Disposition.DELIVERED),
      ).to.not.revert(ethers);
    });

    it("keeps the disposition of transactions recorded before it was deprecated", async function () {
      const { registry } = await loadFixture(txsFixture);
      await registry.setOrderTxDispositionActive(Disposition.LOCKED, false);

      expect((await registry.getOrderTxs(ORDER.orderId))[0].disposition).to.equal(Disposition.LOCKED);
    });

    it("rejects setOrderTxDispositionActive for an unknown disposition", async function () {
      const { registry } = await loadFixture(baseFixture);
      await expect(registry.setOrderTxDispositionActive(REFUNDED, false)).to.be.revertedWith("Unknown disposition");
    });

    it("rejects non-admin callers, including operators", async function () {
      const { registry, operator, other } = await loadFixture(baseFixture);

      await expect(registry.connect(operator).registerOrderTxDisposition(REFUNDED, ""))
        .to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount")
        .withArgs(operator.address, ADMIN_ROLE);
      await expect(registry.connect(other).setOrderTxDispositionActive(Disposition.LOCKED, false))
        .to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount")
        .withArgs(other.address, ADMIN_ROLE);
    });
  });

  describe("recordOrderTx", function () {
    it("registers a TRANSFER on the source chain and appends it to the order", async function () {
      const { registry, txRegistry, operator, orderKey } = await loadFixture(orderFixture);

      const tx = registry.connect(operator).recordOrderTx(ORDER.orderId, Role.TRANSFER, TRANSFER_INFO, SOURCE_TX, []);
      await expect(tx).to.emit(registry, "OrderTxLinked").withArgs(orderKey, 0n, Role.TRANSFER, 1n, operator.address);
      await expect(tx).to.emit(registry, "OrderTxEvidenceUpdated").withArgs(orderKey, 0n, Disposition.LOCKED);
      await expect(tx).to.emit(txRegistry, "TxRegistered").withArgs(1n, XDC_CHAIN, SOURCE_TX.txHash, await registry.getAddress());

      expect(await registry.getOrderTxCount(ORDER.orderId)).to.equal(1n);

      const [orderTx] = await registry.getOrderTxs(ORDER.orderId);
      expect(orderTx.orderId).to.equal(ORDER.orderId);
      expect(orderTx.role).to.equal(Role.TRANSFER);
      expect(orderTx.chainId).to.equal(XDC_CHAIN);
      expect(orderTx.connectorId).to.equal(TRANSFER_INFO.connectorId);
      expect(orderTx.standard).to.equal(TRANSFER_INFO.standard);
      expect(orderTx.disposition).to.equal(Disposition.LOCKED);
      expect(orderTx.txId).to.equal(1n);

      const stored = await txRegistry.getTx(1);
      expect(stored.chainId).to.equal(XDC_CHAIN);
      expect(stored.txHash).to.equal(SOURCE_TX.txHash);
      expect(stored.amount).to.equal(SOURCE_TX.amount);
      expect(stored.registeredBy).to.equal(await registry.getAddress());
    });

    it("registers a DELIVERY on the destination chain", async function () {
      const { registry, txRegistry, operator } = await loadFixture(orderFixture);

      await registry.connect(operator).recordOrderTx(ORDER.orderId, Role.DELIVERY, DELIVERY_INFO, DESTINATION_TX, []);

      const [orderTx] = await registry.getOrderTxs(ORDER.orderId);
      expect(orderTx.role).to.equal(Role.DELIVERY);
      expect(orderTx.chainId).to.equal(XRPL_CHAIN);
      expect(orderTx.standard).to.equal("XRPL_IOU");
      expect(orderTx.txId).to.equal(1n);

      const stored = await txRegistry.getTx(1);
      expect(stored.chainId).to.equal(XRPL_CHAIN);
      expect(stored.txHash).to.equal(DESTINATION_TX.txHash);
    });

    it("registers the LOCK acknowledgment on the source chain", async function () {
      const { registry, txRegistry, operator } = await loadFixture(txsFixture);

      await registry.connect(operator).recordOrderTx(ORDER.orderId, Role.LOCK, LOCK_INFO, LOCK_TX, []);

      const txs = await registry.getOrderTxs(ORDER.orderId);
      expect(txs.length).to.equal(3);
      expect(txs[2].role).to.equal(Role.LOCK);
      expect(txs[2].chainId).to.equal(XDC_CHAIN);
      expect(txs[2].disposition).to.equal(Disposition.NONE);
      expect(txs[2].txId).to.equal(3n);

      // the lock is now a real transaction of the registry, on the source chain
      const stored = await txRegistry.getTx(3);
      expect(stored.chainId).to.equal(XDC_CHAIN);
      expect(stored.txHash).to.equal(LOCK_TX.txHash);
    });

    it("returns the txId and the index in the list", async function () {
      const { registry, operator } = await loadFixture(txsFixture);

      const [txId, index] = await registry
        .connect(operator)
        .recordOrderTx.staticCall(ORDER.orderId, Role.LOCK, LOCK_INFO, LOCK_TX, []);
      expect(txId).to.equal(3n);
      expect(index).to.equal(2n);
    });

    it("keeps the transactions in the order they were recorded", async function () {
      const { registry, operator } = await loadFixture(orderFixture);
      const r = registry.connect(operator);

      await r.recordOrderTx(ORDER.orderId, Role.TRANSFER, TRANSFER_INFO, SOURCE_TX, []);
      await r.recordOrderTx(ORDER.orderId, Role.LOCK, LOCK_INFO, LOCK_TX, []);
      await r.recordOrderTx(ORDER.orderId, Role.DELIVERY, DELIVERY_INFO, DESTINATION_TX, []);

      const txs = await registry.getOrderTxs(ORDER.orderId);
      expect(txs.map((t) => t.role)).to.deep.equal([Role.TRANSFER, Role.LOCK, Role.DELIVERY]);
      expect(txs.map((t) => t.txId)).to.deep.equal([1n, 2n, 3n]);
      expect(txs.map((t) => t.chainId)).to.deep.equal([XDC_CHAIN, XDC_CHAIN, XRPL_CHAIN]);
    });

    it("accepts several transactions with the same role", async function () {
      const { registry, operator } = await loadFixture(txsFixture);

      // a second delivery, e.g. a partial delivery or a retry
      const second = { ...DESTINATION_TX, txHash: "AB".repeat(32), amount: 1n };
      await registry.connect(operator).recordOrderTx(ORDER.orderId, Role.DELIVERY, DELIVERY_INFO, second, []);

      const txs = await registry.getOrderTxs(ORDER.orderId);
      expect(txs.length).to.equal(3);
      expect(txs[1].role).to.equal(Role.DELIVERY);
      expect(txs[2].role).to.equal(Role.DELIVERY);
      expect(txs[2].txId).to.equal(3n);
    });

    it("keeps the lists of different orders apart", async function () {
      const { registry, operator } = await loadFixture(txsFixture);
      await registry.connect(operator).registerOrder("order-2", FUND.fundId, "0x" + "33".repeat(32), { ...INTENT, orderId: "order-2" }, ORDER.createdAt);

      expect(await registry.getOrderTxCount("order-2")).to.equal(0n);

      await registry.connect(operator).recordOrderTx("order-2", Role.LOCK, LOCK_INFO, LOCK_TX, []);
      expect(await registry.getOrderTxCount("order-2")).to.equal(1n);
      expect((await registry.getOrderTxs("order-2"))[0].orderId).to.equal("order-2");
      expect(await registry.getOrderTxCount(ORDER.orderId)).to.equal(2n);
    });

    it("passes the extra args through to MultiChainTxRegistry", async function () {
      const { registry, txRegistry, operator } = await loadFixture(orderFixture);
      await txRegistry.registerSchemaKey("xrpl:testnet", key("sequence"), "uint32", "", true);

      await expect(
        registry.connect(operator).recordOrderTx(ORDER.orderId, Role.DELIVERY, DELIVERY_INFO, DESTINATION_TX, []),
      ).to.be.revertedWith("Missing required extra arg");

      const args = [{ key: key("sequence"), value: abi.encode(["uint32"], [20725947]) }];
      await registry.connect(operator).recordOrderTx(ORDER.orderId, Role.DELIVERY, DELIVERY_INFO, DESTINATION_TX, args);

      const stored = await txRegistry.getExtraArgs(1);
      expect(abi.decode(["uint32"], stored[0].value)[0]).to.equal(20725947n);
    });

    it("rejects a transaction already registered in MultiChainTxRegistry", async function () {
      const { registry, operator } = await loadFixture(txsFixture);

      // same order, same hash again
      await expect(
        registry.connect(operator).recordOrderTx(ORDER.orderId, Role.TRANSFER, TRANSFER_INFO, SOURCE_TX, []),
      ).to.be.revertedWith("Tx already registered");

      // another order trying to reuse the same source tx
      await registry.connect(operator).registerOrder("order-2", FUND.fundId, "0x" + "33".repeat(32), { ...INTENT, orderId: "order-2" }, ORDER.createdAt);
      await expect(
        registry.connect(operator).recordOrderTx("order-2", Role.TRANSFER, TRANSFER_INFO, SOURCE_TX, []),
      ).to.be.revertedWith("Tx already registered");

      expect(await registry.getOrderTxCount(ORDER.orderId)).to.equal(2n);
      expect(await registry.getOrderTxCount("order-2")).to.equal(0n);
    });

    it("rejects an unknown order", async function () {
      const { registry, operator } = await loadFixture(orderFixture);
      await expect(
        registry.connect(operator).recordOrderTx("nope", Role.TRANSFER, TRANSFER_INFO, SOURCE_TX, []),
      ).to.be.revertedWith("Unknown order");
    });

    it("rejects non-operator callers", async function () {
      const { registry, other } = await loadFixture(orderFixture);
      await expect(
        registry.connect(other).recordOrderTx(ORDER.orderId, Role.TRANSFER, TRANSFER_INFO, SOURCE_TX, []),
      ).to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
    });

    it("reverts when the contract lost the relayer role", async function () {
      const { registry, txRegistry, operator } = await loadFixture(orderFixture);
      await txRegistry.revokeRole(RELAYER_ROLE, await registry.getAddress());

      await expect(
        registry.connect(operator).recordOrderTx(ORDER.orderId, Role.TRANSFER, TRANSFER_INFO, SOURCE_TX, []),
      ).to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
    });
  });

  describe("updateOrderTxEvidence", function () {
    it("updates the disposition and emits OrderTxEvidenceUpdated", async function () {
      const { registry, operator, orderKey } = await loadFixture(txsFixture);

      await expect(registry.connect(operator).updateOrderTxEvidence(ORDER.orderId, 1, Disposition.NONE))
        .to.emit(registry, "OrderTxEvidenceUpdated")
        .withArgs(orderKey, 1n, Disposition.NONE);

      const txs = await registry.getOrderTxs(ORDER.orderId);
      expect(txs[1].disposition).to.equal(Disposition.NONE);
      // the rest of the entry is untouched
      expect(txs[1].txId).to.equal(2n);
      expect(txs[1].standard).to.equal(DELIVERY_INFO.standard);
      // the other entry is untouched
      expect(txs[0].disposition).to.equal(Disposition.LOCKED);
    });

    it("rejects an index outside the list", async function () {
      const { registry, operator } = await loadFixture(txsFixture);

      await expect(
        registry.connect(operator).updateOrderTxEvidence(ORDER.orderId, 2, Disposition.LOCKED),
      ).to.be.revertedWith("Unknown order tx");
    });

    it("rejects any index while the order has no transactions", async function () {
      const { registry, operator } = await loadFixture(orderFixture);

      await expect(
        registry.connect(operator).updateOrderTxEvidence(ORDER.orderId, 0, Disposition.LOCKED),
      ).to.be.revertedWith("Unknown order tx");
    });

    it("rejects an unknown order", async function () {
      const { registry, operator } = await loadFixture(orderFixture);
      await expect(
        registry.connect(operator).updateOrderTxEvidence("nope", 0, Disposition.LOCKED),
      ).to.be.revertedWith("Unknown order");
    });

    it("rejects non-operator callers", async function () {
      const { registry, other } = await loadFixture(txsFixture);
      await expect(
        registry.connect(other).updateOrderTxEvidence(ORDER.orderId, 0, Disposition.LOCKED),
      ).to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
    });
  });

  describe("updateOrderTxStatus", function () {
    it("updates the transaction status in MultiChainTxRegistry", async function () {
      const { registry, txRegistry, operator } = await loadFixture(txsFixture);

      await expect(registry.connect(operator).updateOrderTxStatus(ORDER.orderId, 0, TxStatus.FAILED))
        .to.emit(txRegistry, "TxStatusUpdated")
        .withArgs(1n, TxStatus.FAILED);

      expect((await txRegistry.getTx(1)).status).to.equal(BigInt(TxStatus.FAILED));
      // the other transaction is untouched
      expect((await txRegistry.getTx(2)).status).to.equal(BigInt(TxStatus.CONFIRMED));
    });

    it("rejects an index outside the list", async function () {
      const { registry, operator } = await loadFixture(txsFixture);
      await expect(
        registry.connect(operator).updateOrderTxStatus(ORDER.orderId, 2, TxStatus.CONFIRMED),
      ).to.be.revertedWith("Unknown order tx");
    });

    it("rejects an unknown order", async function () {
      const { registry, operator } = await loadFixture(txsFixture);
      await expect(
        registry.connect(operator).updateOrderTxStatus("nope", 0, TxStatus.CONFIRMED),
      ).to.be.revertedWith("Unknown order");
    });

    it("rejects non-operator callers", async function () {
      const { registry, other } = await loadFixture(txsFixture);
      await expect(
        registry.connect(other).updateOrderTxStatus(ORDER.orderId, 0, TxStatus.CONFIRMED),
      ).to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
    });
  });

  describe("updateOrderProgress", function () {
    it("updates the projection and emits OrderProgressUpdated", async function () {
      const { registry, operator, orderKey } = await loadFixture(orderFixture);

      await expect(
        registry.connect(operator).updateOrderProgress(ORDER.orderId, OrderProgress.ACQUIRED_WITH_LOCK, 3, 1789310957n),
      )
        .to.emit(registry, "OrderProgressUpdated")
        .withArgs(orderKey, OrderProgress.ACQUIRED_WITH_LOCK, 3);

      const o = await registry.getOrder(ORDER.orderId);
      expect(o.progress).to.equal(BigInt(OrderProgress.ACQUIRED_WITH_LOCK));
      expect(o.version).to.equal(3n);
      expect(o.updatedAt).to.equal(1789310957n);
      expect(o.createdAt).to.equal(ORDER.createdAt);
    });

    it("accepts the same version again", async function () {
      const { registry, operator, orderKey } = await loadFixture(orderFixture);
      await registry.connect(operator).updateOrderProgress(ORDER.orderId, OrderProgress.AWAITING_DELIVERY, 3, ORDER.createdAt + 1n);

      await expect(
        registry.connect(operator).updateOrderProgress(ORDER.orderId, OrderProgress.ACQUIRED_WITH_LOCK, 3, ORDER.createdAt + 2n),
      ).to.not.revert(ethers);
      expect((await registry.getOrder(ORDER.orderId)).progress).to.equal(BigInt(OrderProgress.ACQUIRED_WITH_LOCK));
    });

    it("rejects an updatedAt before the order createdAt", async function () {
      const { registry, operator, orderKey } = await loadFixture(orderFixture);

      await expect(
        registry.connect(operator).updateOrderProgress(ORDER.orderId, OrderProgress.AWAITING_DELIVERY, 2, ORDER.createdAt - 1n),
      ).to.be.revertedWith("updatedAt before createdAt");
      await expect(
        registry.connect(operator).updateOrderProgress(ORDER.orderId, OrderProgress.AWAITING_DELIVERY, 2, 0n),
      ).to.be.revertedWith("updatedAt before createdAt");

      // nothing changed
      const o = await registry.getOrder(ORDER.orderId);
      expect(o.version).to.equal(0n);
      expect(o.updatedAt).to.equal(ORDER.createdAt);
    });

    it("accepts an updatedAt equal to createdAt (order never updated at the source)", async function () {
      const { registry, operator, orderKey } = await loadFixture(orderFixture);

      await expect(
        registry.connect(operator).updateOrderProgress(ORDER.orderId, OrderProgress.AWAITING_ORIGIN, 1, ORDER.createdAt),
      ).to.not.revert(ethers);

      const o = await registry.getOrder(ORDER.orderId);
      expect(o.version).to.equal(1n);
      expect(o.updatedAt).to.equal(ORDER.createdAt);
    });

    it("rejects an updatedAt before the previous updatedAt", async function () {
      const { registry, operator, orderKey } = await loadFixture(orderFixture);
      await registry.connect(operator).updateOrderProgress(ORDER.orderId, OrderProgress.AWAITING_DELIVERY, 2, ORDER.createdAt + 100n);

      // newer version, older timestamp (still after createdAt)
      await expect(
        registry.connect(operator).updateOrderProgress(ORDER.orderId, OrderProgress.ACQUIRED_WITH_LOCK, 3, ORDER.createdAt + 99n),
      ).to.be.revertedWith("updatedAt not after previous");

      // nothing changed
      const o = await registry.getOrder(ORDER.orderId);
      expect(o.progress).to.equal(BigInt(OrderProgress.AWAITING_DELIVERY));
      expect(o.version).to.equal(2n);
      expect(o.updatedAt).to.equal(ORDER.createdAt + 100n);
    });

    it("rejects an updatedAt equal to the previous updatedAt", async function () {
      const { registry, operator, orderKey } = await loadFixture(orderFixture);
      await registry.connect(operator).updateOrderProgress(ORDER.orderId, OrderProgress.AWAITING_DELIVERY, 2, ORDER.createdAt + 100n);

      await expect(
        registry.connect(operator).updateOrderProgress(ORDER.orderId, OrderProgress.ACQUIRED_WITH_LOCK, 3, ORDER.createdAt + 100n),
      ).to.be.revertedWith("updatedAt not after previous");
      expect((await registry.getOrder(ORDER.orderId)).version).to.equal(2n);

      // one second later is accepted
      await registry.connect(operator).updateOrderProgress(ORDER.orderId, OrderProgress.ACQUIRED_WITH_LOCK, 3, ORDER.createdAt + 101n);
      expect((await registry.getOrder(ORDER.orderId)).version).to.equal(3n);
    });

    it("allows updatedAt equal to createdAt only while the order has no projection (version 0)", async function () {
      const { registry, operator, orderKey } = await loadFixture(orderFixture);

      // first projection of an order never updated at the source
      await registry.connect(operator).updateOrderProgress(ORDER.orderId, OrderProgress.AWAITING_ORIGIN, 1, ORDER.createdAt);

      // from version 1 on, the same timestamp is rejected
      await expect(
        registry.connect(operator).updateOrderProgress(ORDER.orderId, OrderProgress.AWAITING_DELIVERY, 2, ORDER.createdAt),
      ).to.be.revertedWith("updatedAt not after previous");
    });

    it("rejects a stale version", async function () {
      const { registry, operator, orderKey } = await loadFixture(orderFixture);
      await registry.connect(operator).updateOrderProgress(ORDER.orderId, OrderProgress.AWAITING_DELIVERY, 3, ORDER.createdAt + 1n);

      await expect(
        registry.connect(operator).updateOrderProgress(ORDER.orderId, OrderProgress.AWAITING_ORIGIN, 2, ORDER.createdAt + 2n),
      ).to.be.revertedWith("Stale version");
      expect((await registry.getOrder(ORDER.orderId)).progress).to.equal(BigInt(OrderProgress.AWAITING_DELIVERY));
    });

    it("rejects an unknown order", async function () {
      const { registry, operator } = await loadFixture(orderFixture);
      await expect(
        registry.connect(operator).updateOrderProgress("nope", OrderProgress.AWAITING_ORIGIN, 1, 1n),
      ).to.be.revertedWith("Unknown order");
    });

    it("rejects non-operator callers", async function () {
      const { registry, other, orderKey } = await loadFixture(orderFixture);
      await expect(
        registry.connect(other).updateOrderProgress(ORDER.orderId, OrderProgress.AWAITING_ORIGIN, 1, ORDER.createdAt),
      ).to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
    });
  });

  describe("View functions", function () {
    it("getOrder, getOrderIntent and the order tx views reject an unknown order", async function () {
      const { registry } = await loadFixture(deployFixture);
      await expect(registry.getOrder("nope")).to.be.revertedWith("Unknown order");
      await expect(registry.getOrderIntent("nope")).to.be.revertedWith("Unknown order");
      await expect(registry.getOrderTxs("nope")).to.be.revertedWith("Unknown order");
      await expect(registry.getOrderTxCount("nope")).to.be.revertedWith("Unknown order");
      await expect(registry.getOrderTx("nope", 0)).to.be.revertedWith("Unknown order");
    });

    it("finds the fund by its fundId as text, ignoring case and whitespace", async function () {
      const { funds, registry, operator } = await loadFixture(orderFixture);
      const variant = " " + FUND.fundId.toUpperCase() + "\t";

      expect((await funds.getFund(variant)).fundId).to.equal(FUND.fundId);
      expect(await registry.getOrdersByFund(variant)).to.deep.equal([ORDER.orderId]);

      // registerOrder and recordFundCreationTx resolve the same fund
      await registry.connect(operator).registerOrder("order-2", variant, "0x" + "44".repeat(32), { ...INTENT, orderId: "order-2" }, ORDER.createdAt);
      expect((await registry.getOrder("order-2")).fundKey).to.equal(keyOf(FUND.fundId));
      expect((await registry.getOrdersByFund(FUND.fundId)).length).to.equal(2);

      await funds.connect(operator).recordFundCreationTx(variant, FUND_CREATION_TX, []);
      expect((await funds.getFund(FUND.fundId)).creationTxId).to.equal(1n);
    });

    it("finds the order by its orderId as text, ignoring case and whitespace", async function () {
      const { registry, operator } = await loadFixture(orderFixture);
      const variant = " " + ORDER.orderId.toUpperCase() + " ";

      expect((await registry.getOrder(variant)).orderId).to.equal(ORDER.orderId);
      expect((await registry.getOrderIntent(variant)).beneficiary).to.equal(INTENT.beneficiary);

      await registry.connect(operator).recordOrderTx(variant, Role.TRANSFER, TRANSFER_INFO, SOURCE_TX, []);
      expect((await registry.getOrderTxs(ORDER.orderId))[0].txId).to.equal(1n);
      expect(await registry.getOrderTxCount(variant)).to.equal(1n);

      await registry.connect(operator).updateOrderProgress(variant, OrderProgress.AWAITING_DELIVERY, 2, ORDER.createdAt + 1n);
      expect((await registry.getOrder(ORDER.orderId)).version).to.equal(2n);
    });

    it("rejects an empty orderId in every order function", async function () {
      const { registry, operator } = await loadFixture(orderFixture);
      const r = registry.connect(operator);

      await expect(registry.getOrder("")).to.be.revertedWith("Empty id");
      await expect(registry.getOrderIntent("")).to.be.revertedWith("Empty id");
      await expect(registry.getOrderTxs(" ")).to.be.revertedWith("Empty id");
      await expect(registry.getOrderTxCount("")).to.be.revertedWith("Empty id");
      await expect(registry.getOrderTx("", 0)).to.be.revertedWith("Empty id");
      await expect(r.recordOrderTx("", Role.TRANSFER, TRANSFER_INFO, SOURCE_TX, [])).to.be.revertedWith("Empty id");
      await expect(r.updateOrderTxEvidence("", 0, Disposition.LOCKED)).to.be.revertedWith("Empty id");
      await expect(r.updateOrderTxStatus("", 0, TxStatus.CONFIRMED)).to.be.revertedWith("Empty id");
      await expect(r.updateOrderProgress("", OrderProgress.AWAITING_ORIGIN, 1, ORDER.createdAt)).to.be.revertedWith("Empty id");
    });

    it("getOrdersByFund returns the orderIds in registration order", async function () {
      const { registry, operator } = await loadFixture(orderFixture);
      await registry.connect(operator).registerOrder("order-2", FUND.fundId, "0x" + "55".repeat(32), { ...INTENT, orderId: "order-2" }, ORDER.createdAt);

      expect(await registry.getOrdersByFund(FUND.fundId)).to.deep.equal([ORDER.orderId, "order-2"]);
    });

    it("getOrderIdByIntentHash returns the orderId, or empty for an unknown intentHash", async function () {
      const { registry } = await loadFixture(orderFixture);

      expect(await registry.getOrderIdByIntentHash(ORDER.intentHash)).to.equal(ORDER.orderId);
      expect(await registry.getOrderIdByIntentHash("0x" + "99".repeat(32))).to.equal("");
    });

    it("rejects an empty fundId in the order functions that take one", async function () {
      const { registry, operator } = await loadFixture(fundFixture);

      await expect(registry.getOrdersByFund(" ")).to.be.revertedWith("Empty id");
      await expect(
        registry.connect(operator).registerOrder(ORDER.orderId, "", ORDER.intentHash, INTENT, ORDER.createdAt),
      ).to.be.revertedWith("Empty id");
    });

    it("getOrdersByFund is empty for an unknown fund", async function () {
      const { registry } = await loadFixture(deployFixture);
      expect(await registry.getOrdersByFund("nope")).to.deep.equal([]);
    });

    it("getOrderTx returns the entry and the transaction from MultiChainTxRegistry", async function () {
      const { registry } = await loadFixture(txsFixture);

      const [orderTx, txData] = await registry.getOrderTx(ORDER.orderId, 1);
      expect(orderTx.orderId).to.equal(ORDER.orderId);
      expect(orderTx.role).to.equal(Role.DELIVERY);
      expect(orderTx.txId).to.equal(2n);
      expect(orderTx.standard).to.equal("XRPL_IOU");
      expect(txData.id).to.equal(2n);
      expect(txData.chainId).to.equal(XRPL_CHAIN);
      expect(txData.txHash).to.equal(DESTINATION_TX.txHash);
      expect(txData.amount).to.equal(DESTINATION_TX.amount);
    });

    it("getOrderSyncStates returns the state of many orders, in the order asked", async function () {
      const { registry, operator } = await loadFixture(txsFixture);
      await registry
        .connect(operator)
        .registerOrder("order-2", FUND.fundId, "0x" + "22".repeat(32), { ...INTENT, orderId: "order-2" }, ORDER.createdAt + 10n);
      await registry
        .connect(operator)
        .updateOrderProgress(ORDER.orderId, OrderProgress.ACQUIRED_WITH_LOCK, 3, ORDER.createdAt + 500n);

      const states = await registry.getOrderSyncStates(["order-2", ORDER.orderId]);
      expect(states.length).to.equal(2);

      // registered, no transactions, still as registerOrder left it
      expect(states[0].registered).to.equal(true);
      expect(states[0].progress).to.equal(OrderProgress.AWAITING_ORIGIN);
      expect(states[0].version).to.equal(0n);
      expect(states[0].createdAt).to.equal(ORDER.createdAt + 10n);
      expect(states[0].updatedAt).to.equal(ORDER.createdAt + 10n);
      expect(states[0].roles).to.deep.equal([]);

      // the transfer and the delivery of txsFixture, plus the progress update
      expect(states[1].registered).to.equal(true);
      expect(states[1].progress).to.equal(OrderProgress.ACQUIRED_WITH_LOCK);
      expect(states[1].version).to.equal(3n);
      expect(states[1].createdAt).to.equal(ORDER.createdAt);
      expect(states[1].updatedAt).to.equal(ORDER.createdAt + 500n);
      expect(states[1].roles).to.deep.equal([Role.TRANSFER, Role.DELIVERY]);
    });

    it("getOrderSyncStates marks an unknown order instead of reverting", async function () {
      const { registry } = await loadFixture(orderFixture);

      const states = await registry.getOrderSyncStates(["nope", ORDER.orderId.toUpperCase()]);
      expect(states[0].registered).to.equal(false);
      expect(states[0].version).to.equal(0n);
      expect(states[0].createdAt).to.equal(0n);
      expect(states[0].roles).to.deep.equal([]);
      // the id is normalized as in every other function
      expect(states[1].registered).to.equal(true);
    });

    it("getOrderSyncStates accepts an empty list and rejects an empty id", async function () {
      const { registry } = await loadFixture(orderFixture);

      expect(await registry.getOrderSyncStates([])).to.deep.equal([]);
      await expect(registry.getOrderSyncStates([ORDER.orderId, " "])).to.be.revertedWith("Empty id");
    });

    it("getOrderTx rejects an index outside the list", async function () {
      const { registry } = await loadFixture(txsFixture);

      await expect(registry.getOrderTx(ORDER.orderId, 2)).to.be.revertedWith("Unknown order tx");
    });
  });

  // End-to-end: two funds, one order each, every transaction in MultiChainTxRegistry
  describe("Scenario: two funds with orders on XRPL and Stellar", function () {
    it("keeps funds, orders and transactions consistent", async function () {
      const { funds, registry, txRegistry, operator } = await loadFixture(deployFixture);
      const r = registry.connect(operator);

      const fundKey1 = keyOf(FUND.fundId);
      const fundKey2 = keyOf(FUND2.fundId);
      await funds.connect(operator).registerFund(FUND, FUND_CREATION_TX, []);                                   // tx 1
      await funds.connect(operator).registerFund(FUND2, { ...FUND_CREATION_TX, txHash: "" }, []);

      const orderKey1 = keyOf(ORDER.orderId);
      const orderKey2 = keyOf(ORDER2.orderId);
      await r.registerOrder(ORDER.orderId, FUND.fundId, ORDER.intentHash, INTENT, ORDER.createdAt);
      await r.registerOrder(ORDER2.orderId, FUND2.fundId, ORDER2.intentHash, INTENT2, ORDER2.createdAt);

      await r.recordOrderTx(ORDER.orderId, Role.TRANSFER, TRANSFER_INFO, SOURCE_TX, []);          // tx 2
      await r.recordOrderTx(ORDER.orderId, Role.LOCK, LOCK_INFO, LOCK_TX, []);                    // tx 3
      await r.recordOrderTx(ORDER.orderId, Role.DELIVERY, DELIVERY_INFO, DESTINATION_TX, []);     // tx 4
      await r.recordOrderTx(ORDER2.orderId, Role.DELIVERY, DELIVERY2_INFO, DESTINATION2_TX, []);  // tx 5
      await r.updateOrderProgress(ORDER.orderId, OrderProgress.ACQUIRED_WITH_LOCK, 3, 1789310957n);
      await r.updateOrderProgress(ORDER2.orderId, OrderProgress.AWAITING_ORIGIN, 1, ORDER2.createdAt);

      expect(await funds.getFundCount()).to.equal(2n);
      expect(await registry.getOrdersByFund(FUND.fundId)).to.deep.equal([ORDER.orderId]);
      expect(await registry.getOrdersByFund(FUND2.fundId)).to.deep.equal([ORDER2.orderId]);
      expect(await txRegistry.txCount()).to.equal(5n);

      expect((await funds.getFund(FUND.fundId)).creationTxId).to.equal(1n);
      expect((await funds.getFund(FUND2.fundId)).creationTxId).to.equal(0n);

      const txs1 = await registry.getOrderTxs(ORDER.orderId);
      expect(txs1.map((t) => t.role)).to.deep.equal([Role.TRANSFER, Role.LOCK, Role.DELIVERY]);
      expect(txs1.map((t) => t.txId)).to.deep.equal([2n, 3n, 4n]);

      const txs2 = await registry.getOrderTxs(ORDER2.orderId);
      expect(txs2.length).to.equal(1);
      expect(txs2[0].role).to.equal(Role.DELIVERY);
      expect(txs2[0].txId).to.equal(5n);

      // every transaction landed on the chain of its role
      expect((await txRegistry.getTx(1)).chainId).to.equal(XDC_CHAIN);
      expect((await txRegistry.getTx(2)).chainId).to.equal(XDC_CHAIN);
      expect((await txRegistry.getTx(3)).chainId).to.equal(XDC_CHAIN);
      expect((await txRegistry.getTx(4)).chainId).to.equal(XRPL_CHAIN);
      expect((await txRegistry.getTx(5)).chainId).to.equal(STELLAR_CHAIN);
      expect(await txRegistry.txIdsByChain(XDC_CHAIN, 2)).to.equal(3n);
      expect(await txRegistry.txIdsByChain(STELLAR_CHAIN, 0)).to.equal(5n);

      expect((await registry.getOrder(ORDER.orderId)).progress).to.equal(BigInt(OrderProgress.ACQUIRED_WITH_LOCK));
      expect((await registry.getOrder(ORDER2.orderId)).progress).to.equal(BigInt(OrderProgress.AWAITING_ORIGIN));
    });
  });
});
