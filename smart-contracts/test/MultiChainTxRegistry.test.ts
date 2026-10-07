import { expect } from "chai";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.create();
const { loadFixture } = networkHelpers;

const abi = ethers.AbiCoder.defaultAbiCoder();
const ZERO_HASH = ethers.ZeroHash;

// AccessControl role ids
const ADMIN_ROLE = ethers.ZeroHash; // DEFAULT_ADMIN_ROLE
const RELAYER_ROLE = ethers.id("RELAYER_ROLE");

enum TxStatus {
  PENDING = 0,
  CONFIRMED = 1,
  FAILED = 2,
}

// keccak256 of the normalized network string, mirroring the contract
function chainIdOf(network: string): string {
  return ethers.keccak256(ethers.toUtf8Bytes(network));
}

function key(name: string): string {
  return ethers.encodeBytes32String(name);
}

function addressKey(addr: string): string {
  return ethers.keccak256(ethers.toUtf8Bytes(addr));
}

// Index key used by the contract for duplicate detection: keccak256(chainId, normalized txHash)
function txIndexKey(chainId: string, txHash: string): string {
  const normalized = txHash.replace(/[ \t\n\r]/g, "").toLowerCase();
  return ethers.keccak256(ethers.concat([chainId, ethers.toUtf8Bytes(normalized)]));
}

// ============================================================
// SAMPLE DATA (from MultiChainTxRegistry.md)
// ============================================================

const XDC = {
  network: "eip155:51",
  networkChainId: "51",
  name: "XDC",
  profileId: "xdc-apothem",
  genesisHash: "0xbdea512b4f12ff1135ec92c00dc047ffb93890c2ea1aa0eefe9b013d80640075",
};

const XRPL = {
  network: "xrpl:testnet",
  networkChainId: "",
  name: "XRPL",
  profileId: "",
  genesisHash: ZERO_HASH,
};

const STELLAR = {
  network: "stellar:testnet",
  networkChainId: "",
  name: "STELLAR",
  profileId: "",
  genesisHash: ZERO_HASH,
};

const XDC_TX = {
  status: TxStatus.CONFIRMED,
  txHash: "0x5cf581d7bf2c25cc22aa20edfbb63e78bdb82798425c3a59875b3d5207372c0d",
  from: "0x8d9ac9f2fc551276805a30ab2b387c1bf1cf7f80",
  to: "0x16d53e6c7016ff8d706a3202a7a49491d18d58d5",
  amount: 6000n * 10n ** 18n,
  assetCode: "BRL-CVM",
  assetIssuer: "0x243e98638d619eb6f10eabbacfc071f318d5e9d0",
  txType: "transfer",
  data: "0x",
  dataType: "",
  blockNumber: 87056956n,
  timestamp: 0n,
};

const XRPL_TX = {
  status: TxStatus.CONFIRMED,
  txHash: "107EDFF0CA0CE5CE4BFC98F422C1D0D3DAA6B4612D81F065EA198703EE77F46A",
  from: "r4zbotBezN7gGuanHUiwsXJrBGE91m1MDH",
  to: "rffW8Pf5yNp9xXPMo47LARGEkzSTxrYAsL",
  amount: 5500n * 10n ** 6n,
  assetCode: "CVD",
  assetIssuer: "r9aceEB7Qy5JrHtYt2KGhF4KVMgEGjoY2U",
  txType: "Payment",
  data: "0x",
  dataType: "",
  blockNumber: 20935718n,
  timestamp: 0n,
};

const STELLAR_TX = {
  status: TxStatus.CONFIRMED,
  txHash: "03ccf55d6ddc471b7bcd77d5c2cb95137fb48765a975d3cf5996c54d4bc194a3",
  from: "GDAHUE7RJ3RZ4PRTS7ZVJ2G6H4OLCSW3BLPEFAJ7XSLBQAMGQV4OXMFL",
  to: "GCPN5BJYXPRHGB3YIUOHSC4S6OYZKLHNIK7LYTVXRBCAPTHDYC7F7RFW",
  amount: 6000n * 10n ** 7n,
  assetCode: "CVD",
  assetIssuer: "GDRR62CPM7TD4OHVZC6ZIBUUD3O4M7TWWOXZ4VHCWK3QTJ34PC3SZX54",
  txType: "payment",
  data: "0x",
  dataType: "",
  blockNumber: 4793929n,
  timestamp: 0n,
};

// ============================================================
// FIXTURES
// ============================================================

async function deployFixture() {
  const [owner, relayer, other] = await ethers.getSigners();
  const registry = await ethers.deployContract("MultiChainTxRegistry");
  await registry.waitForDeployment();
  return { registry, owner, relayer, other };
}

/// Contract with one relayer and the XDC chain registered (no schema keys).
async function chainFixture() {
  const base = await deployFixture();
  const { registry, relayer } = base;

  await registry.grantRole(RELAYER_ROLE, relayer.address);
  await registry.registerChain(XDC.network, XDC.networkChainId, XDC.name, XDC.profileId, XDC.genesisHash);

  return { ...base, chainId: chainIdOf(XDC.network) };
}

/// chainFixture plus a schema: "logIndex" (required) and "blockHash" (optional).
async function schemaFixture() {
  const base = await chainFixture();
  const { registry } = base;

  await registry.registerSchemaKey(XDC.network, key("logIndex"), "uint256", "Log index", true);
  await registry.registerSchemaKey(XDC.network, key("blockHash"), "bytes32", "Block hash", false);

  const requiredArgs = [{ key: key("logIndex"), value: abi.encode(["uint256"], [61]) }];

  return { ...base, requiredArgs };
}

// ============================================================
// TESTS
// ============================================================

describe("MultiChainTxRegistry", function () {
  describe("Deployment", function () {
    it("sets the deployer as owner", async function () {
      const { registry, owner } = await loadFixture(deployFixture);
      expect(await registry.hasRole(ADMIN_ROLE, owner.address)).to.equal(true);
    });

    it("starts with no chains and no transactions", async function () {
      const { registry } = await loadFixture(deployFixture);
      expect(await registry.txCount()).to.equal(0n);
      expect(await registry.getChainCount()).to.equal(0n);
    });

    it("starts with no relayers", async function () {
      const { registry, owner } = await loadFixture(deployFixture);
      expect(await registry.hasRole(RELAYER_ROLE, owner.address)).to.equal(false);
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
      await expect(registry.connect(other).grantRole(RELAYER_ROLE, owner.address)).to.not.revert(ethers);
    });

    it("hands the contract over when the new admin revokes the old one", async function () {
      const { registry, owner, other } = await loadFixture(deployFixture);
      await registry.grantRole(ADMIN_ROLE, other.address);

      await expect(registry.connect(other).revokeRole(ADMIN_ROLE, owner.address))
        .to.emit(registry, "RoleRevoked")
        .withArgs(ADMIN_ROLE, owner.address, other.address);

      expect(await registry.hasRole(ADMIN_ROLE, owner.address)).to.equal(false);
      await expect(registry.connect(owner).grantRole(RELAYER_ROLE, owner.address))
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
      await registry.grantRole(RELAYER_ROLE, other.address);

      await expect(registry.connect(other).renounceRole(RELAYER_ROLE, other.address))
        .to.emit(registry, "RoleRevoked")
        .withArgs(RELAYER_ROLE, other.address, other.address);
      expect(await registry.hasRole(RELAYER_ROLE, other.address)).to.equal(false);
    });

    it("lets an admin revoke a non-admin role from itself", async function () {
      const { registry, owner } = await loadFixture(deployFixture);
      await registry.grantRole(RELAYER_ROLE, owner.address);

      await expect(registry.revokeRole(RELAYER_ROLE, owner.address)).to.not.revert(ethers);
      expect(await registry.hasRole(RELAYER_ROLE, owner.address)).to.equal(false);
    });

    it("rejects role management from non-admins", async function () {
      const { registry, owner, other } = await loadFixture(deployFixture);

      await expect(registry.connect(other).grantRole(ADMIN_ROLE, other.address))
        .to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount")
        .withArgs(other.address, ADMIN_ROLE);
      await expect(registry.connect(other).revokeRole(ADMIN_ROLE, owner.address))
        .to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount")
        .withArgs(other.address, ADMIN_ROLE);
      await expect(registry.connect(other).grantRole(RELAYER_ROLE, other.address))
        .to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount")
        .withArgs(other.address, ADMIN_ROLE);
    });
  });

  describe("RELAYER_ROLE", function () {
    it("has the id keccak256(\"RELAYER_ROLE\")", async function () {
      const { registry } = await loadFixture(deployFixture);
      expect(await registry.RELAYER_ROLE()).to.equal(RELAYER_ROLE);
    });

    it("is granted and revoked by the admin, emitting RoleGranted and RoleRevoked", async function () {
      const { registry, owner, other } = await loadFixture(deployFixture);

      await expect(registry.grantRole(RELAYER_ROLE, other.address))
        .to.emit(registry, "RoleGranted")
        .withArgs(RELAYER_ROLE, other.address, owner.address);
      expect(await registry.hasRole(RELAYER_ROLE, other.address)).to.equal(true);

      await expect(registry.revokeRole(RELAYER_ROLE, other.address))
        .to.emit(registry, "RoleRevoked")
        .withArgs(RELAYER_ROLE, other.address, owner.address);
      expect(await registry.hasRole(RELAYER_ROLE, other.address)).to.equal(false);
    });

    it("is not held by the admin unless it is granted", async function () {
      const { registry, owner } = await loadFixture(deployFixture);
      // the admin manages chains, schema and roles, but does not register transactions
      expect(await registry.hasRole(RELAYER_ROLE, owner.address)).to.equal(false);
    });

    it("cannot be granted by an account that only has RELAYER_ROLE", async function () {
      const { registry, other } = await loadFixture(deployFixture);
      await registry.grantRole(RELAYER_ROLE, other.address);

      await expect(registry.connect(other).grantRole(RELAYER_ROLE, other.address))
        .to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount")
        .withArgs(other.address, ADMIN_ROLE);
    });
  });

  describe("computeChainId", function () {
    it("returns keccak256 of the network string", async function () {
      const { registry } = await loadFixture(deployFixture);
      expect(await registry.computeChainId("eip155:51")).to.equal(chainIdOf("eip155:51"));
    });

    it("lowercases the network string", async function () {
      const { registry } = await loadFixture(deployFixture);
      expect(await registry.computeChainId("XRPL:TestNet")).to.equal(chainIdOf("xrpl:testnet"));
    });

    it("removes spaces, tabs and line breaks", async function () {
      const { registry } = await loadFixture(deployFixture);
      expect(await registry.computeChainId(" stellar :\ttest\nnet\r")).to.equal(chainIdOf("stellar:testnet"));
    });

    it("keeps digits and punctuation untouched", async function () {
      const { registry } = await loadFixture(deployFixture);
      expect(await registry.computeChainId("eip155:51")).to.equal(await registry.computeChainId("EIP155:51"));
      expect(await registry.computeChainId("eip155:51")).to.not.equal(await registry.computeChainId("eip155:52"));
    });
  });

  describe("registerChain", function () {
    it("stores the chain with the normalized network and emits ChainRegistered", async function () {
      const { registry } = await loadFixture(deployFixture);
      const chainId = chainIdOf(XDC.network);

      await expect(
        registry.registerChain(" EIP155:51 ", XDC.networkChainId, XDC.name, XDC.profileId, XDC.genesisHash),
      )
        .to.emit(registry, "ChainRegistered")
        .withArgs(chainId, XDC.network, XDC.networkChainId, XDC.name, XDC.profileId, XDC.genesisHash);

      const info = await registry.chains(chainId);
      expect(info.chainId).to.equal(chainId);
      expect(info.network).to.equal(XDC.network);
      expect(info.networkChainId).to.equal(XDC.networkChainId);
      expect(info.name).to.equal(XDC.name);
      expect(info.profileId).to.equal(XDC.profileId);
      expect(info.genesisHash).to.equal(XDC.genesisHash);
    });

    it("returns the chainId", async function () {
      const { registry } = await loadFixture(deployFixture);
      const returned = await registry.registerChain.staticCall(
        XDC.network, XDC.networkChainId, XDC.name, XDC.profileId, XDC.genesisHash,
      );
      expect(returned).to.equal(chainIdOf(XDC.network));
    });

    it("appends to chainIds and increments getChainCount", async function () {
      const { registry } = await loadFixture(deployFixture);

      await registry.registerChain(XDC.network, XDC.networkChainId, XDC.name, XDC.profileId, XDC.genesisHash);
      await registry.registerChain(XRPL.network, XRPL.networkChainId, XRPL.name, XRPL.profileId, XRPL.genesisHash);

      expect(await registry.getChainCount()).to.equal(2n);
      expect(await registry.chainIds(0)).to.equal(chainIdOf(XDC.network));
      expect(await registry.chainIds(1)).to.equal(chainIdOf(XRPL.network));
    });

    it("accepts empty optional fields", async function () {
      const { registry } = await loadFixture(deployFixture);
      await registry.registerChain(XRPL.network, "", "", "", ZERO_HASH);

      const info = await registry.chains(chainIdOf(XRPL.network));
      expect(info.chainId).to.equal(chainIdOf(XRPL.network));
      expect(info.networkChainId).to.equal("");
      expect(info.genesisHash).to.equal(ZERO_HASH);
    });

    it("rejects a duplicated chain", async function () {
      const { registry } = await loadFixture(deployFixture);
      await registry.registerChain(XDC.network, XDC.networkChainId, XDC.name, XDC.profileId, XDC.genesisHash);

      await expect(
        registry.registerChain(XDC.network, XDC.networkChainId, XDC.name, XDC.profileId, XDC.genesisHash),
      ).to.be.revertedWith("Chain already registered");
    });

    it("treats networks that only differ in case or whitespace as duplicates", async function () {
      const { registry } = await loadFixture(deployFixture);
      await registry.registerChain(XDC.network, XDC.networkChainId, XDC.name, XDC.profileId, XDC.genesisHash);

      await expect(
        registry.registerChain("EIP155: 51", XDC.networkChainId, XDC.name, XDC.profileId, XDC.genesisHash),
      ).to.be.revertedWith("Chain already registered");
    });

    it("rejects an empty network", async function () {
      const { registry } = await loadFixture(deployFixture);
      await expect(registry.registerChain("", "", "", "", ZERO_HASH)).to.be.revertedWith("Invalid network");
    });

    it("rejects a network made only of whitespace", async function () {
      const { registry } = await loadFixture(deployFixture);
      await expect(registry.registerChain(" \t\n", "", "", "", ZERO_HASH)).to.be.revertedWith("Invalid network");
    });

    it("rejects a network longer than 64 bytes after normalization", async function () {
      const { registry } = await loadFixture(deployFixture);

      await expect(registry.registerChain("a".repeat(65), "", "", "", ZERO_HASH)).to.be.revertedWith("Invalid network");
      // 64 bytes is still accepted
      await expect(registry.registerChain("a".repeat(64), "", "", "", ZERO_HASH)).to.not.revert(ethers);
    });

    it("rejects non-owner callers", async function () {
      const { registry, other } = await loadFixture(deployFixture);
      await expect(
        registry.connect(other).registerChain(XDC.network, XDC.networkChainId, XDC.name, XDC.profileId, XDC.genesisHash),
      ).to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
    });
  });

  describe("registerSchemaKey", function () {
    it("stores the key, emits SchemaKeyRegistered and exposes it in getSchema", async function () {
      const { registry, chainId } = await loadFixture(chainFixture);

      await expect(registry.registerSchemaKey(XDC.network, key("logIndex"), "uint256", "Log index", true))
        .to.emit(registry, "SchemaKeyRegistered")
        .withArgs(chainId, XDC.network, key("logIndex"), "uint256", true);

      const schema = await registry.getSchema(XDC.network);
      expect(schema.length).to.equal(1);
      expect(schema[0].key).to.equal(key("logIndex"));
      expect(schema[0].valueType).to.equal("uint256");
      expect(schema[0].description).to.equal("Log index");
      expect(schema[0].required).to.equal(true);
      expect(schema[0].active).to.equal(true);
    });

    it("keeps the keys in registration order", async function () {
      const { registry } = await loadFixture(chainFixture);

      await registry.registerSchemaKey(XDC.network, key("logIndex"), "uint256", "", true);
      await registry.registerSchemaKey(XDC.network, key("blockHash"), "bytes32", "", false);

      const schema = await registry.getSchema(XDC.network);
      expect(schema.map((s) => s.key)).to.deep.equal([key("logIndex"), key("blockHash")]);
    });

    it("normalizes the network string", async function () {
      const { registry } = await loadFixture(chainFixture);
      await registry.registerSchemaKey(" EIP155:51 ", key("logIndex"), "uint256", "", true);

      expect((await registry.getSchema(XDC.network)).length).to.equal(1);
      expect((await registry.getSchema("eip155 : 51")).length).to.equal(1);
    });

    it("allows the same key on different chains", async function () {
      const { registry } = await loadFixture(chainFixture);
      await registry.registerChain(XRPL.network, XRPL.networkChainId, XRPL.name, XRPL.profileId, XRPL.genesisHash);

      await registry.registerSchemaKey(XDC.network, key("sequence"), "uint32", "", true);
      await registry.registerSchemaKey(XRPL.network, key("sequence"), "uint32", "", true);

      expect((await registry.getSchema(XDC.network)).length).to.equal(1);
      expect((await registry.getSchema(XRPL.network)).length).to.equal(1);
    });

    it("rejects an empty key", async function () {
      const { registry } = await loadFixture(chainFixture);
      await expect(registry.registerSchemaKey(XDC.network, ZERO_HASH, "uint256", "", true)).to.be.revertedWith("Empty key");
    });

    it("rejects an unregistered chain", async function () {
      const { registry } = await loadFixture(chainFixture);
      await expect(
        registry.registerSchemaKey(XRPL.network, key("sequence"), "uint32", "", true),
      ).to.be.revertedWith("Chain not registered");
    });

    it("rejects a duplicated key on the same chain", async function () {
      const { registry } = await loadFixture(chainFixture);
      await registry.registerSchemaKey(XDC.network, key("logIndex"), "uint256", "", true);

      await expect(
        registry.registerSchemaKey(XDC.network, key("logIndex"), "uint256", "", false),
      ).to.be.revertedWith("Key already registered");
    });

    it("rejects non-owner callers", async function () {
      const { registry, other } = await loadFixture(chainFixture);
      await expect(
        registry.connect(other).registerSchemaKey(XDC.network, key("logIndex"), "uint256", "", true),
      ).to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
    });
  });

  describe("setSchemaKeyActive", function () {
    it("deprecates and reactivates a key, emitting SchemaKeyStatusUpdated", async function () {
      const { registry, chainId } = await loadFixture(schemaFixture);

      await expect(registry.setSchemaKeyActive(XDC.network, key("logIndex"), false))
        .to.emit(registry, "SchemaKeyStatusUpdated")
        .withArgs(chainId, key("logIndex"), false);
      expect((await registry.getSchema(XDC.network))[0].active).to.equal(false);

      await expect(registry.setSchemaKeyActive(XDC.network, key("logIndex"), true))
        .to.emit(registry, "SchemaKeyStatusUpdated")
        .withArgs(chainId, key("logIndex"), true);
      expect((await registry.getSchema(XDC.network))[0].active).to.equal(true);
    });

    it("only changes the targeted key", async function () {
      const { registry } = await loadFixture(schemaFixture);
      await registry.setSchemaKeyActive(XDC.network, key("blockHash"), false);

      const schema = await registry.getSchema(XDC.network);
      expect(schema[0].active).to.equal(true);  // logIndex
      expect(schema[1].active).to.equal(false); // blockHash
    });

    it("rejects an unregistered key", async function () {
      const { registry } = await loadFixture(schemaFixture);
      await expect(registry.setSchemaKeyActive(XDC.network, key("nope"), false)).to.be.revertedWith("Key not registered");
    });

    it("rejects a key of an unregistered chain", async function () {
      const { registry } = await loadFixture(schemaFixture);
      await expect(registry.setSchemaKeyActive(XRPL.network, key("logIndex"), false)).to.be.revertedWith("Key not registered");
    });

    it("rejects non-owner callers", async function () {
      const { registry, other } = await loadFixture(schemaFixture);
      await expect(
        registry.connect(other).setSchemaKeyActive(XDC.network, key("logIndex"), false),
      ).to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
    });
  });

  describe("registerTx", function () {
    it("stores every field, fills the contract-managed ones and emits TxRegistered", async function () {
      const { registry, relayer, chainId } = await loadFixture(chainFixture);

      const tx = await registry.connect(relayer).registerTx(chainId, XDC_TX, []);
      await expect(tx).to.emit(registry, "TxRegistered").withArgs(1n, chainId, XDC_TX.txHash, relayer.address);

      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt!.blockNumber);

      const stored = await registry.getTx(1);
      expect(stored.id).to.equal(1n);
      expect(stored.chainId).to.equal(chainId);
      expect(stored.status).to.equal(BigInt(XDC_TX.status));
      expect(stored.txHash).to.equal(XDC_TX.txHash);
      expect(stored.from).to.equal(XDC_TX.from);
      expect(stored.to).to.equal(XDC_TX.to);
      expect(stored.amount).to.equal(XDC_TX.amount);
      expect(stored.assetCode).to.equal(XDC_TX.assetCode);
      expect(stored.assetIssuer).to.equal(XDC_TX.assetIssuer);
      expect(stored.txType).to.equal(XDC_TX.txType);
      expect(stored.data).to.equal(XDC_TX.data);
      expect(stored.dataType).to.equal(XDC_TX.dataType);
      expect(stored.blockNumber).to.equal(XDC_TX.blockNumber);
      expect(stored.timestamp).to.equal(XDC_TX.timestamp);
      expect(stored.registeredAt).to.equal(BigInt(block!.timestamp));
      expect(stored.registeredBy).to.equal(relayer.address);
    });

    it("returns sequential ids and increments txCount", async function () {
      const { registry, relayer, chainId } = await loadFixture(chainFixture);

      const first = await registry.connect(relayer).registerTx.staticCall(chainId, XDC_TX, []);
      expect(first).to.equal(1n);
      await registry.connect(relayer).registerTx(chainId, XDC_TX, []);

      const second = await registry.connect(relayer).registerTx.staticCall(chainId, { ...XDC_TX, txHash: "0xabc" }, []);
      expect(second).to.equal(2n);
      await registry.connect(relayer).registerTx(chainId, { ...XDC_TX, txHash: "0xabc" }, []);

      expect(await registry.txCount()).to.equal(2n);
    });

    it("stores calldata-style data and dataType", async function () {
      const { registry, relayer, chainId } = await loadFixture(chainFixture);
      const data = "0xa9059cbb000000000000000000000000000000000000000000000000000000000000dead";

      await registry.connect(relayer).registerTx(chainId, { ...XDC_TX, data, dataType: "calldata" }, []);

      const stored = await registry.getTx(1);
      expect(stored.data).to.equal(data);
      expect(stored.dataType).to.equal("calldata");
    });

    it("indexes the tx by chain and normalized txHash", async function () {
      const { registry, relayer, chainId } = await loadFixture(chainFixture);
      await registry.connect(relayer).registerTx(chainId, XDC_TX, []);

      expect(await registry.txIndex(txIndexKey(chainId, XDC_TX.txHash))).to.equal(1n);
      expect(await registry.txIndex(txIndexKey(chainId, "unknown"))).to.equal(0n);
    });

    it("indexes the tx by chain", async function () {
      const { registry, relayer, chainId } = await loadFixture(chainFixture);
      await registry.connect(relayer).registerTx(chainId, XDC_TX, []);
      await registry.connect(relayer).registerTx(chainId, { ...XDC_TX, txHash: "0xabc" }, []);

      expect(await registry.txIdsByChain(chainId, 0)).to.equal(1n);
      expect(await registry.txIdsByChain(chainId, 1)).to.equal(2n);
    });

    it("indexes the tx by both from and to addresses", async function () {
      const { registry, relayer, chainId } = await loadFixture(chainFixture);
      await registry.connect(relayer).registerTx(chainId, XDC_TX, []);

      expect(await registry.txIdsByAddress(addressKey(XDC_TX.from), 0)).to.equal(1n);
      expect(await registry.txIdsByAddress(addressKey(XDC_TX.to), 0)).to.equal(1n);
    });

    it("indexes a self-transfer only once per address", async function () {
      const { registry, relayer, chainId } = await loadFixture(chainFixture);
      await registry.connect(relayer).registerTx(chainId, { ...XDC_TX, to: XDC_TX.from }, []);

      expect(await registry.txIdsByAddress(addressKey(XDC_TX.from), 0)).to.equal(1n);
      // A second entry would be a read past the array end; the public getter reverts without data
      await expect(registry.txIdsByAddress(addressKey(XDC_TX.from), 1)).to.be.revertedWithoutReason(ethers);
    });

    it("stores the extra args", async function () {
      const { registry, relayer, chainId, requiredArgs } = await loadFixture(schemaFixture);
      const blockHash = "0x02cb557532fec9d86cab0fe1f39d23a14e086743d5afff4bb9216c0d8586777b";
      const args = [
        ...requiredArgs,
        { key: key("blockHash"), value: abi.encode(["bytes32"], [blockHash]) },
      ];

      await registry.connect(relayer).registerTx(chainId, XDC_TX, args);

      expect(await registry.getExtraArgsLength(1)).to.equal(2n);

      const stored = await registry.getExtraArgs(1);
      expect(stored.length).to.equal(2);
      expect(stored[0].key).to.equal(key("logIndex"));
      expect(abi.decode(["uint256"], stored[0].value)[0]).to.equal(61n);
      expect(stored[1].key).to.equal(key("blockHash"));
      expect(abi.decode(["bytes32"], stored[1].value)[0]).to.equal(blockHash);
    });

    it("accepts the same txHash on different chains", async function () {
      const { registry, relayer, chainId } = await loadFixture(chainFixture);
      await registry.registerChain(XRPL.network, XRPL.networkChainId, XRPL.name, XRPL.profileId, XRPL.genesisHash);

      await registry.connect(relayer).registerTx(chainId, XDC_TX, []);
      await expect(registry.connect(relayer).registerTx(chainIdOf(XRPL.network), XDC_TX, [])).to.not.revert(ethers);
    });

    it("rejects a duplicated txHash on the same chain", async function () {
      const { registry, relayer, chainId } = await loadFixture(chainFixture);
      await registry.connect(relayer).registerTx(chainId, XDC_TX, []);

      await expect(registry.connect(relayer).registerTx(chainId, XDC_TX, [])).to.be.revertedWith("Tx already registered");
    });

    it("compares txHash ignoring case and whitespace", async function () {
      const { registry, relayer, chainId } = await loadFixture(chainFixture);
      await registry.connect(relayer).registerTx(chainId, XDC_TX, []);

      const upper = { ...XDC_TX, txHash: " " + XDC_TX.txHash.toUpperCase() };
      await expect(registry.connect(relayer).registerTx(chainId, upper, [])).to.be.revertedWith("Tx already registered");
    });

    it("rejects an unregistered chain", async function () {
      const { registry, relayer } = await loadFixture(chainFixture);
      await expect(
        registry.connect(relayer).registerTx(chainIdOf(XRPL.network), XDC_TX, []),
      ).to.be.revertedWith("Chain not registered");
    });

    it("rejects an empty txHash", async function () {
      const { registry, relayer, chainId } = await loadFixture(chainFixture);
      await expect(
        registry.connect(relayer).registerTx(chainId, { ...XDC_TX, txHash: "" }, []),
      ).to.be.revertedWith("Empty txHash");
    });

    it("rejects non-relayer callers, including the owner", async function () {
      const { registry, owner, other, chainId } = await loadFixture(chainFixture);

      await expect(registry.connect(owner).registerTx(chainId, XDC_TX, [])).to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
      await expect(registry.connect(other).registerTx(chainId, XDC_TX, [])).to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
    });

    it("rejects a revoked relayer", async function () {
      const { registry, relayer, chainId } = await loadFixture(chainFixture);
      await registry.revokeRole(RELAYER_ROLE, relayer.address);

      await expect(registry.connect(relayer).registerTx(chainId, XDC_TX, [])).to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
    });

    it("does not change state when it reverts", async function () {
      const { registry, relayer, chainId } = await loadFixture(chainFixture);

      await expect(registry.connect(relayer).registerTx(chainId, { ...XDC_TX, txHash: "" }, [])).to.be.revertedWith("Empty txHash");

      expect(await registry.txCount()).to.equal(0n);
      await expect(registry.txIdsByChain(chainId, 0)).to.be.revertedWithoutReason(ethers);
    });
  });

  describe("registerTx: extra args validation", function () {
    it("rejects an unknown key", async function () {
      const { registry, relayer, chainId, requiredArgs } = await loadFixture(schemaFixture);
      const args = [...requiredArgs, { key: key("nope"), value: "0x" }];

      await expect(registry.connect(relayer).registerTx(chainId, XDC_TX, args)).to.be.revertedWith("Unknown extra arg key");
    });

    it("rejects a key registered on another chain", async function () {
      const { registry, relayer, chainId } = await loadFixture(chainFixture);
      await registry.registerChain(XRPL.network, XRPL.networkChainId, XRPL.name, XRPL.profileId, XRPL.genesisHash);
      await registry.registerSchemaKey(XRPL.network, key("sequence"), "uint32", "", false);

      const args = [{ key: key("sequence"), value: abi.encode(["uint32"], [1]) }];
      await expect(registry.connect(relayer).registerTx(chainId, XDC_TX, args)).to.be.revertedWith("Unknown extra arg key");
    });

    it("rejects a deprecated key", async function () {
      const { registry, relayer, chainId, requiredArgs } = await loadFixture(schemaFixture);
      await registry.setSchemaKeyActive(XDC.network, key("blockHash"), false);

      const args = [...requiredArgs, { key: key("blockHash"), value: abi.encode(["bytes32"], [ZERO_HASH]) }];
      await expect(registry.connect(relayer).registerTx(chainId, XDC_TX, args)).to.be.revertedWith("Extra arg key deprecated");
    });

    it("rejects a duplicated key", async function () {
      const { registry, relayer, chainId, requiredArgs } = await loadFixture(schemaFixture);
      const args = [...requiredArgs, ...requiredArgs];

      await expect(registry.connect(relayer).registerTx(chainId, XDC_TX, args)).to.be.revertedWith("Duplicated extra arg key");
    });

    it("rejects a missing required key", async function () {
      const { registry, relayer, chainId } = await loadFixture(schemaFixture);

      await expect(registry.connect(relayer).registerTx(chainId, XDC_TX, [])).to.be.revertedWith("Missing required extra arg");

      const onlyOptional = [{ key: key("blockHash"), value: abi.encode(["bytes32"], [ZERO_HASH]) }];
      await expect(registry.connect(relayer).registerTx(chainId, XDC_TX, onlyOptional)).to.be.revertedWith("Missing required extra arg");
    });

    it("accepts omitting an optional key", async function () {
      const { registry, relayer, chainId, requiredArgs } = await loadFixture(schemaFixture);
      await expect(registry.connect(relayer).registerTx(chainId, XDC_TX, requiredArgs)).to.not.revert(ethers);
    });

    it("accepts extra args in any order", async function () {
      const { registry, relayer, chainId, requiredArgs } = await loadFixture(schemaFixture);
      const args = [{ key: key("blockHash"), value: abi.encode(["bytes32"], [ZERO_HASH]) }, ...requiredArgs];

      await expect(registry.connect(relayer).registerTx(chainId, XDC_TX, args)).to.not.revert(ethers);
    });

    it("no longer requires a deprecated required key", async function () {
      const { registry, relayer, chainId } = await loadFixture(schemaFixture);
      await registry.setSchemaKeyActive(XDC.network, key("logIndex"), false);

      await expect(registry.connect(relayer).registerTx(chainId, XDC_TX, [])).to.not.revert(ethers);
    });

    it("requires a reactivated key again", async function () {
      const { registry, relayer, chainId } = await loadFixture(schemaFixture);
      await registry.setSchemaKeyActive(XDC.network, key("logIndex"), false);
      await registry.setSchemaKeyActive(XDC.network, key("logIndex"), true);

      await expect(registry.connect(relayer).registerTx(chainId, XDC_TX, [])).to.be.revertedWith("Missing required extra arg");
    });

    it("accepts an empty list when the chain has no schema", async function () {
      const { registry, relayer, chainId } = await loadFixture(chainFixture);
      await expect(registry.connect(relayer).registerTx(chainId, XDC_TX, [])).to.not.revert(ethers);
    });
  });

  describe("updateTxStatus", function () {
    it("changes the status and emits TxStatusUpdated", async function () {
      const { registry, relayer, chainId } = await loadFixture(chainFixture);
      await registry.connect(relayer).registerTx(chainId, { ...XDC_TX, status: TxStatus.PENDING }, []);

      await expect(registry.connect(relayer).updateTxStatus(1, TxStatus.CONFIRMED))
        .to.emit(registry, "TxStatusUpdated")
        .withArgs(1n, BigInt(TxStatus.CONFIRMED));
      expect((await registry.getTx(1)).status).to.equal(BigInt(TxStatus.CONFIRMED));

      await registry.connect(relayer).updateTxStatus(1, TxStatus.FAILED);
      expect((await registry.getTx(1)).status).to.equal(BigInt(TxStatus.FAILED));
    });

    it("keeps the other fields unchanged", async function () {
      const { registry, relayer, chainId } = await loadFixture(chainFixture);
      await registry.connect(relayer).registerTx(chainId, XDC_TX, []);
      const before = await registry.getTx(1);

      await registry.connect(relayer).updateTxStatus(1, TxStatus.FAILED);
      const after = await registry.getTx(1);

      expect(after.txHash).to.equal(before.txHash);
      expect(after.amount).to.equal(before.amount);
      expect(after.registeredAt).to.equal(before.registeredAt);
      expect(after.registeredBy).to.equal(before.registeredBy);
    });

    it("rejects id 0 and ids above txCount", async function () {
      const { registry, relayer, chainId } = await loadFixture(chainFixture);
      await registry.connect(relayer).registerTx(chainId, XDC_TX, []);

      await expect(registry.connect(relayer).updateTxStatus(0, TxStatus.CONFIRMED)).to.be.revertedWith("Unknown tx");
      await expect(registry.connect(relayer).updateTxStatus(2, TxStatus.CONFIRMED)).to.be.revertedWith("Unknown tx");
    });

    it("rejects an invalid status value", async function () {
      const { registry, relayer, chainId } = await loadFixture(chainFixture);
      await registry.connect(relayer).registerTx(chainId, XDC_TX, []);

      // 3 is outside the TxStatus enum: the ABI decoder reverts without data
      await expect(registry.connect(relayer).updateTxStatus(1, 3)).to.be.revertedWithoutReason(ethers);
    });

    it("rejects non-relayer callers, including the owner", async function () {
      const { registry, owner, other, relayer, chainId } = await loadFixture(chainFixture);
      await registry.connect(relayer).registerTx(chainId, XDC_TX, []);

      await expect(registry.connect(owner).updateTxStatus(1, TxStatus.FAILED)).to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
      await expect(registry.connect(other).updateTxStatus(1, TxStatus.FAILED)).to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
    });
  });

  describe("View functions", function () {
    it("getTx rejects id 0 and unknown ids", async function () {
      const { registry, relayer, chainId } = await loadFixture(chainFixture);

      await expect(registry.getTx(0)).to.be.revertedWith("Unknown tx");
      await expect(registry.getTx(1)).to.be.revertedWith("Unknown tx");

      await registry.connect(relayer).registerTx(chainId, XDC_TX, []);
      await expect(registry.getTx(1)).to.not.revert(ethers);
      await expect(registry.getTx(2)).to.be.revertedWith("Unknown tx");
    });

    it("getExtraArgs and getExtraArgsLength are empty for unknown ids", async function () {
      const { registry } = await loadFixture(deployFixture);
      expect(await registry.getExtraArgs(99)).to.deep.equal([]);
      expect(await registry.getExtraArgsLength(99)).to.equal(0n);
    });

    it("getSchema is empty for an unregistered chain", async function () {
      const { registry } = await loadFixture(deployFixture);
      expect(await registry.getSchema("nope")).to.deep.equal([]);
    });

    it("chains returns an empty struct for an unregistered chainId", async function () {
      const { registry } = await loadFixture(deployFixture);
      const info = await registry.chains(chainIdOf("nope"));
      expect(info.chainId).to.equal(ZERO_HASH);
      expect(info.network).to.equal("");
    });
  });

  // End-to-end scenario with the data documented in MultiChainTxRegistry.md
  describe("Scenario: the three documented networks", function () {
    async function scenarioFixture() {
      const base = await deployFixture();
      const { registry, relayer } = base;

      await registry.grantRole(RELAYER_ROLE, relayer.address);

      for (const chain of [XDC, XRPL, STELLAR]) {
        await registry.registerChain(chain.network, chain.networkChainId, chain.name, chain.profileId, chain.genesisHash);
      }

      await registry.registerSchemaKey(XDC.network, key("blockHash"), "bytes32", "Block hash", false);
      await registry.registerSchemaKey(XDC.network, key("logIndex"), "uint256", "Log index", true);
      await registry.registerSchemaKey(XDC.network, key("lockTxHash"), "bytes32", "Lock tx hash", false);

      await registry.registerSchemaKey(XRPL.network, key("ledgerHash"), "bytes32", "Ledger hash", false);
      await registry.registerSchemaKey(XRPL.network, key("sequence"), "uint32", "Account sequence", true);

      await registry.registerSchemaKey(STELLAR.network, key("ledgerHash"), "bytes32", "Ledger hash", false);
      await registry.registerSchemaKey(STELLAR.network, key("sequence"), "uint64", "Account sequence", true);

      return base;
    }

    const XDC_ARGS = [
      { key: key("blockHash"), value: abi.encode(["bytes32"], ["0x02cb557532fec9d86cab0fe1f39d23a14e086743d5afff4bb9216c0d8586777b"]) },
      { key: key("logIndex"), value: abi.encode(["uint256"], [61]) },
      { key: key("lockTxHash"), value: abi.encode(["bytes32"], ["0xb8556d1c05f45d13afb34b3913c575f2b668094ec85139eb5819adf722f39fe7"]) },
    ];

    const XRPL_ARGS = [
      { key: key("ledgerHash"), value: abi.encode(["bytes32"], ["0x9DB069EA281640551D7BF62C1698AEA2C62A4AB7423B0E4E18662BEB208B3AE5"]) },
      { key: key("sequence"), value: abi.encode(["uint32"], [20914264]) },
    ];

    const STELLAR_ARGS = [
      { key: key("ledgerHash"), value: abi.encode(["bytes32"], ["0x638c89c3121601d292abc61204c23f019f9bab86659967cc98fdb8dee1458d4b"]) },
      { key: key("sequence"), value: abi.encode(["uint64"], [20442893277724677n]) },
    ];

    it("registers the three chains", async function () {
      const { registry } = await loadFixture(scenarioFixture);

      expect(await registry.getChainCount()).to.equal(3n);
      expect((await registry.chains(chainIdOf(XDC.network))).name).to.equal("XDC");
      expect((await registry.chains(chainIdOf(XRPL.network))).name).to.equal("XRPL");
      expect((await registry.chains(chainIdOf(STELLAR.network))).name).to.equal("STELLAR");
    });

    it("registers one transaction per chain with its extra args", async function () {
      const { registry, relayer } = await loadFixture(scenarioFixture);
      const r = registry.connect(relayer);

      await r.registerTx(chainIdOf(XDC.network), XDC_TX, XDC_ARGS);
      await r.registerTx(chainIdOf(XRPL.network), XRPL_TX, XRPL_ARGS);
      await r.registerTx(chainIdOf(STELLAR.network), STELLAR_TX, STELLAR_ARGS);

      expect(await registry.txCount()).to.equal(3n);

      const xdc = await registry.getTx(1);
      expect(xdc.chainId).to.equal(chainIdOf(XDC.network));
      expect(xdc.amount).to.equal(6000n * 10n ** 18n);
      expect(await registry.getExtraArgsLength(1)).to.equal(3n);

      const xrpl = await registry.getTx(2);
      expect(xrpl.chainId).to.equal(chainIdOf(XRPL.network));
      expect(xrpl.amount).to.equal(5500n * 10n ** 6n);
      const xrplArgs = await registry.getExtraArgs(2);
      expect(abi.decode(["uint32"], xrplArgs[1].value)[0]).to.equal(20914264n);

      const stellar = await registry.getTx(3);
      expect(stellar.chainId).to.equal(chainIdOf(STELLAR.network));
      expect(stellar.amount).to.equal(6000n * 10n ** 7n);
      const stellarArgs = await registry.getExtraArgs(3);
      expect(abi.decode(["uint64"], stellarArgs[1].value)[0]).to.equal(20442893277724677n);

      // Each chain index holds exactly its own tx
      expect(await registry.txIdsByChain(chainIdOf(XDC.network), 0)).to.equal(1n);
      expect(await registry.txIdsByChain(chainIdOf(XRPL.network), 0)).to.equal(2n);
      expect(await registry.txIdsByChain(chainIdOf(STELLAR.network), 0)).to.equal(3n);
    });

    it("enforces each chain's own required keys", async function () {
      const { registry, relayer } = await loadFixture(scenarioFixture);
      const r = registry.connect(relayer);

      // XRPL requires "sequence"; sending only ledgerHash fails
      await expect(r.registerTx(chainIdOf(XRPL.network), XRPL_TX, [XRPL_ARGS[0]])).to.be.revertedWith("Missing required extra arg");

      // XDC does not know "ledgerHash"
      await expect(r.registerTx(chainIdOf(XDC.network), XDC_TX, [XRPL_ARGS[0], XDC_ARGS[1]])).to.be.revertedWith("Unknown extra arg key");
    });
  });
});
