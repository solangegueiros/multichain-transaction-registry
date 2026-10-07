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

describe("FundRegistry", function () {
  describe("Deployment", function () {
    it("stores the MultiChainTxRegistry address and the owner", async function () {
      const { funds, txRegistry, owner } = await loadFixture(deployFixture);
      expect(await funds.txRegistry()).to.equal(await txRegistry.getAddress());
      expect(await funds.hasRole(ADMIN_ROLE, owner.address)).to.equal(true);
      expect(await funds.getFundCount()).to.equal(0n);
    });

    it("rejects a zero registry address", async function () {
      await expect(ethers.deployContract("FundRegistry", [ethers.ZeroAddress])).to.be.revertedWith("Zero registry");
    });
  });

  describe("Admin role (AdminProtected)", function () {
    it("gives DEFAULT_ADMIN_ROLE to the deployer only", async function () {
      const { funds, owner, other } = await loadFixture(deployFixture);

      expect(await funds.DEFAULT_ADMIN_ROLE()).to.equal(ADMIN_ROLE);
      expect(await funds.hasRole(ADMIN_ROLE, owner.address)).to.equal(true);
      expect(await funds.hasRole(ADMIN_ROLE, other.address)).to.equal(false);
    });

    it("lets an admin grant the admin role to another account", async function () {
      const { funds, owner, other } = await loadFixture(deployFixture);

      await expect(funds.grantRole(ADMIN_ROLE, other.address))
        .to.emit(funds, "RoleGranted")
        .withArgs(ADMIN_ROLE, other.address, owner.address);

      // both are admins now, and the new one manages roles
      expect(await funds.hasRole(ADMIN_ROLE, owner.address)).to.equal(true);
      expect(await funds.hasRole(ADMIN_ROLE, other.address)).to.equal(true);
      await expect(funds.connect(other).grantRole(OPERATOR_ROLE, owner.address)).to.not.revert(ethers);
    });

    it("hands the contract over when the new admin revokes the old one", async function () {
      const { funds, owner, other } = await loadFixture(deployFixture);
      await funds.grantRole(ADMIN_ROLE, other.address);

      await expect(funds.connect(other).revokeRole(ADMIN_ROLE, owner.address))
        .to.emit(funds, "RoleRevoked")
        .withArgs(ADMIN_ROLE, owner.address, other.address);

      expect(await funds.hasRole(ADMIN_ROLE, owner.address)).to.equal(false);
      await expect(funds.connect(owner).grantRole(OPERATOR_ROLE, owner.address))
        .to.be.revertedWithCustomError(funds, "AccessControlUnauthorizedAccount")
        .withArgs(owner.address, ADMIN_ROLE);
    });

    it("does not let an admin renounce the admin role", async function () {
      const { funds, owner, other } = await loadFixture(deployFixture);

      await expect(funds.renounceRole(ADMIN_ROLE, owner.address)).to.be.revertedWith("Admin cannot renounce");

      // not even when another admin exists
      await funds.grantRole(ADMIN_ROLE, other.address);
      await expect(funds.renounceRole(ADMIN_ROLE, owner.address)).to.be.revertedWith("Admin cannot renounce");

      expect(await funds.hasRole(ADMIN_ROLE, owner.address)).to.equal(true);
    });

    it("does not let an admin revoke its own admin role", async function () {
      const { funds, owner, other } = await loadFixture(deployFixture);

      await expect(funds.revokeRole(ADMIN_ROLE, owner.address)).to.be.revertedWith("Admin cannot revoke itself");

      // not even when another admin exists: only the other admin can do it
      await funds.grantRole(ADMIN_ROLE, other.address);
      await expect(funds.revokeRole(ADMIN_ROLE, owner.address)).to.be.revertedWith("Admin cannot revoke itself");
      await expect(funds.connect(other).revokeRole(ADMIN_ROLE, other.address)).to.be.revertedWith("Admin cannot revoke itself");

      expect(await funds.hasRole(ADMIN_ROLE, owner.address)).to.equal(true);
      expect(await funds.hasRole(ADMIN_ROLE, other.address)).to.equal(true);
    });

    it("still lets an account renounce a role that is not the admin role", async function () {
      const { funds, other } = await loadFixture(deployFixture);
      await funds.grantRole(OPERATOR_ROLE, other.address);

      await expect(funds.connect(other).renounceRole(OPERATOR_ROLE, other.address))
        .to.emit(funds, "RoleRevoked")
        .withArgs(OPERATOR_ROLE, other.address, other.address);
      expect(await funds.hasRole(OPERATOR_ROLE, other.address)).to.equal(false);
    });

    it("lets an admin revoke a non-admin role from itself", async function () {
      const { funds, owner } = await loadFixture(deployFixture);
      await funds.grantRole(OPERATOR_ROLE, owner.address);

      await expect(funds.revokeRole(OPERATOR_ROLE, owner.address)).to.not.revert(ethers);
      expect(await funds.hasRole(OPERATOR_ROLE, owner.address)).to.equal(false);
    });

    it("rejects role management from non-admins", async function () {
      const { funds, owner, other } = await loadFixture(deployFixture);

      await expect(funds.connect(other).grantRole(ADMIN_ROLE, other.address))
        .to.be.revertedWithCustomError(funds, "AccessControlUnauthorizedAccount")
        .withArgs(other.address, ADMIN_ROLE);
      await expect(funds.connect(other).revokeRole(ADMIN_ROLE, owner.address))
        .to.be.revertedWithCustomError(funds, "AccessControlUnauthorizedAccount")
        .withArgs(other.address, ADMIN_ROLE);
      await expect(funds.connect(other).grantRole(OPERATOR_ROLE, other.address))
        .to.be.revertedWithCustomError(funds, "AccessControlUnauthorizedAccount")
        .withArgs(other.address, ADMIN_ROLE);
    });
  });

  describe("OPERATOR_ROLE", function () {
    it("has the id keccak256(\"OPERATOR_ROLE\")", async function () {
      const { funds } = await loadFixture(deployFixture);
      expect(await funds.OPERATOR_ROLE()).to.equal(OPERATOR_ROLE);
    });

    it("is granted and revoked by the admin, emitting RoleGranted and RoleRevoked", async function () {
      const { funds, owner, other } = await loadFixture(deployFixture);

      await expect(funds.grantRole(OPERATOR_ROLE, other.address))
        .to.emit(funds, "RoleGranted")
        .withArgs(OPERATOR_ROLE, other.address, owner.address);
      expect(await funds.hasRole(OPERATOR_ROLE, other.address)).to.equal(true);

      await expect(funds.revokeRole(OPERATOR_ROLE, other.address))
        .to.emit(funds, "RoleRevoked")
        .withArgs(OPERATOR_ROLE, other.address, owner.address);
      expect(await funds.hasRole(OPERATOR_ROLE, other.address)).to.equal(false);
    });

    it("is not held by the admin unless it is granted", async function () {
      const { funds, owner } = await loadFixture(deployFixture);
      // the admin manages roles, but does not load data
      expect(await funds.hasRole(OPERATOR_ROLE, owner.address)).to.equal(false);
    });

    it("cannot be granted by an account that only has OPERATOR_ROLE", async function () {
      const { funds, other } = await loadFixture(deployFixture);
      await funds.grantRole(OPERATOR_ROLE, other.address);

      await expect(funds.connect(other).grantRole(OPERATOR_ROLE, other.address))
        .to.be.revertedWithCustomError(funds, "AccessControlUnauthorizedAccount")
        .withArgs(other.address, ADMIN_ROLE);
    });
  });

  describe("keyOf", function () {
    it("returns keccak256 of the lowercased id without whitespace", async function () {
      const { funds } = await loadFixture(deployFixture);
      expect(await funds.keyOf(FUND.fundId)).to.equal(keyOf(FUND.fundId));
      expect(await funds.keyOf(" BE6F2E8A-5474-43c7-a692-7918c37e3f42\n")).to.equal(keyOf(FUND.fundId));
    });

    it("rejects an empty or whitespace-only id", async function () {
      const { funds } = await loadFixture(deployFixture);
      await expect(funds.keyOf("")).to.be.revertedWith("Empty id");
      await expect(funds.keyOf(" \t")).to.be.revertedWith("Empty id");
    });
  });

  describe("registerStableCoin", function () {
    it("stores the stablecoin and emits StableCoinRegistered", async function () {
      const { funds, operator } = await loadFixture(baseFixture);
      const key = stableKeyOf(STABLE.chainId, STABLE.tokenAddress);

      await expect(
        funds.connect(operator).registerStableCoin(STABLE.chainId, STABLE.tokenAddress, STABLE.symbol, STABLE.decimals),
      )
        .to.emit(funds, "StableCoinRegistered")
        .withArgs(key, STABLE.chainId, STABLE.tokenAddress, STABLE.symbol, STABLE.decimals);

      const c = await funds.getStableCoin(STABLE.chainId, STABLE.tokenAddress);
      expect(c.stableKey).to.equal(key);
      expect(c.chainId).to.equal(STABLE.chainId);
      expect(c.tokenAddress).to.equal(STABLE.tokenAddress);
      expect(c.symbol).to.equal(STABLE.symbol);
      expect(c.decimals).to.equal(BigInt(STABLE.decimals));

      expect(await funds.getStableCoinCount()).to.equal(1n);
      expect(await funds.stableCoinKeys(0)).to.equal(key);
    });

    it("returns the stableKey, equal to stableCoinKeyOf", async function () {
      const { funds, operator } = await loadFixture(baseFixture);
      const key = stableKeyOf(STABLE.chainId, STABLE.tokenAddress);

      expect(await funds.stableCoinKeyOf(STABLE.chainId, STABLE.tokenAddress)).to.equal(key);
      const returned = await funds
        .connect(operator)
        .registerStableCoin.staticCall(STABLE.chainId, STABLE.tokenAddress, STABLE.symbol, STABLE.decimals);
      expect(returned).to.equal(key);
    });

    it("registers the three stablecoins of the sample funds", async function () {
      const { funds, txRegistry, operator } = await loadFixture(baseFixture);
      await txRegistry.registerChain("eip155:80002", "80002", "POLYGON", "polygon-amoy", ZERO_HASH);
      await txRegistry.registerChain("eip155:50", "50", "XDC", "xdc-mainnet", ZERO_HASH);

      const coins = [
        { chainId: XDC_CHAIN, tokenAddress: "0x243e98638D619eB6f10eaBbaCfC071f318D5e9d0", symbol: "BRL-CVM" },
        { chainId: keyOf("eip155:80002"), tokenAddress: "0x25fC15B20F67049249FF70BB8A846e66BE07693C", symbol: "BRL1" },
        { chainId: keyOf("eip155:50"), tokenAddress: "0x490590Eab907C4aF8aF845049FC7ac2F97e535F6", symbol: "BRL-CVM-DEV" },
      ];
      for (const c of coins) {
        await funds.connect(operator).registerStableCoin(c.chainId, c.tokenAddress, c.symbol, 18);
      }

      expect(await funds.getStableCoinCount()).to.equal(3n);
      for (const c of coins) {
        expect((await funds.getStableCoin(c.chainId, c.tokenAddress)).symbol).to.equal(c.symbol);
      }
    });

    it("listStableCoins returns every stablecoin in registration order", async function () {
      const { funds, operator } = await loadFixture(baseFixture);

      expect(await funds.listStableCoins()).to.deep.equal([]);

      await funds.connect(operator).registerStableCoin(XDC_CHAIN, STABLE.tokenAddress, "BRL-CVM", 18);
      await funds.connect(operator).registerStableCoin(XRPL_CHAIN, STABLE.tokenAddress, "OTHER", 6);

      const list = await funds.listStableCoins();
      expect(list.length).to.equal(2);

      expect(list[0].stableKey).to.equal(stableKeyOf(XDC_CHAIN, STABLE.tokenAddress));
      expect(list[0].chainId).to.equal(XDC_CHAIN);
      expect(list[0].tokenAddress).to.equal(STABLE.tokenAddress);
      expect(list[0].symbol).to.equal("BRL-CVM");
      expect(list[0].decimals).to.equal(18n);

      expect(list[1].stableKey).to.equal(stableKeyOf(XRPL_CHAIN, STABLE.tokenAddress));
      expect(list[1].chainId).to.equal(XRPL_CHAIN);
      expect(list[1].symbol).to.equal("OTHER");
      expect(list[1].decimals).to.equal(6n);
    });

    it("allows the same token address on different chains", async function () {
      const { funds, operator } = await loadFixture(baseFixture);

      await funds.connect(operator).registerStableCoin(XDC_CHAIN, STABLE.tokenAddress, "BRL-CVM", 18);
      await funds.connect(operator).registerStableCoin(XRPL_CHAIN, STABLE.tokenAddress, "OTHER", 6);

      expect((await funds.getStableCoin(XDC_CHAIN, STABLE.tokenAddress)).symbol).to.equal("BRL-CVM");
      expect((await funds.getStableCoin(XRPL_CHAIN, STABLE.tokenAddress)).decimals).to.equal(6n);
    });

    it("rejects a duplicated stablecoin on the same chain", async function () {
      const { funds, operator } = await loadFixture(deployFixture);
      await expect(
        funds.connect(operator).registerStableCoin(STABLE.chainId, STABLE.tokenAddress, "ANOTHER", 6),
      ).to.be.revertedWith("Stable already registered");
    });

    it("rejects an unregistered chain, a zero address and an empty symbol", async function () {
      const { funds, operator } = await loadFixture(baseFixture);
      const r = funds.connect(operator);

      await expect(r.registerStableCoin(keyOf("eip155:1"), STABLE.tokenAddress, "X", 18)).to.be.revertedWith("Chain not registered");
      await expect(r.registerStableCoin(XDC_CHAIN, ethers.ZeroAddress, "X", 18)).to.be.revertedWith("Zero stable");
      await expect(r.registerStableCoin(XDC_CHAIN, STABLE.tokenAddress, "", 18)).to.be.revertedWith("Empty symbol");
    });

    it("rejects non-operator callers, including the owner", async function () {
      const { funds, owner, other } = await loadFixture(baseFixture);

      await expect(
        funds.connect(owner).registerStableCoin(STABLE.chainId, STABLE.tokenAddress, STABLE.symbol, STABLE.decimals),
      ).to.be.revertedWithCustomError(funds, "AccessControlUnauthorizedAccount");
      await expect(
        funds.connect(other).registerStableCoin(STABLE.chainId, STABLE.tokenAddress, STABLE.symbol, STABLE.decimals),
      ).to.be.revertedWithCustomError(funds, "AccessControlUnauthorizedAccount");
    });

    it("getStableCoin rejects an unknown stablecoin", async function () {
      const { funds, other } = await loadFixture(deployFixture);

      await expect(funds.getStableCoin(STABLE.chainId, other.address)).to.be.revertedWith("Stable not registered");
      await expect(funds.getStableCoin(XRPL_CHAIN, STABLE.tokenAddress)).to.be.revertedWith("Stable not registered");
    });
  });

  describe("registerFund", function () {
    it("stores every field and emits FundRegistered", async function () {
      const { funds, operator } = await loadFixture(deployFixture);
      const fundKey = keyOf(FUND.fundId);

      await expect(funds.connect(operator).registerFund(FUND, { ...FUND_CREATION_TX, txHash: "" }, []))
        .to.emit(funds, "FundRegistered")
        .withArgs(fundKey, FUND.fundId, FUND.fidcId, FUND.chainId);

      const f = await funds.getFund(FUND.fundId);
      expect(f.fundKey).to.equal(fundKey);
      expect(f.fundId).to.equal(FUND.fundId);
      expect(f.fidcId).to.equal(FUND.fidcId);
      expect(f.name).to.equal(FUND.name);
      // the ChainInfo is copied from MultiChainTxRegistry
      expect(f.chain.chainId).to.equal(FUND.chainId);
      expect(f.chain.network).to.equal(CHAINS[0].network);
      expect(f.chain.networkChainId).to.equal(CHAINS[0].networkChainId);
      expect(f.chain.name).to.equal(CHAINS[0].name);
      expect(f.chain.profileId).to.equal(CHAINS[0].profileId);
      expect(f.chain.genesisHash).to.equal(CHAINS[0].genesisHash);
      expect(f.contractAddress).to.equal(FUND.contractAddress);
      // the StableCoin is copied from the stablecoin registry
      expect(f.stable.stableKey).to.equal(stableKeyOf(STABLE.chainId, STABLE.tokenAddress));
      expect(f.stable.chainId).to.equal(STABLE.chainId);
      expect(f.stable.tokenAddress).to.equal(STABLE.tokenAddress);
      expect(f.stable.symbol).to.equal(STABLE.symbol);
      expect(f.stable.decimals).to.equal(BigInt(STABLE.decimals));
      expect(f.creationIntentHash).to.equal(FUND.creationIntentHash);
      expect(f.createdAt).to.equal(FUND.createdAt);
      expect(f.creationTxHash).to.equal("");
      expect(f.creationTxId).to.equal(0n);

      expect(await funds.getFundCount()).to.equal(1n);
      expect(await funds.fundKeys(0)).to.equal(fundKey);
    });

    it("stores the same ChainInfo that MultiChainTxRegistry holds for the chain", async function () {
      const { funds, txRegistry, fundKey } = await loadFixture(fundFixture);

      const inRegistry = await txRegistry.chains(FUND.chainId);
      const inFund = (await funds.getFund(FUND.fundId)).chain;

      expect(inFund.chainId).to.equal(inRegistry.chainId);
      expect(inFund.network).to.equal(inRegistry.network);
      expect(inFund.networkChainId).to.equal(inRegistry.networkChainId);
      expect(inFund.name).to.equal(inRegistry.name);
      expect(inFund.profileId).to.equal(inRegistry.profileId);
      expect(inFund.genesisHash).to.equal(inRegistry.genesisHash);
    });

    it("stores the ChainInfo of a chain with empty optional fields", async function () {
      const { funds, operator } = await loadFixture(deployFixture);
      const fund = { ...FUND, chainId: XRPL_CHAIN };
      await funds.connect(operator).registerStableCoin(XRPL_CHAIN, STABLE.tokenAddress, STABLE.symbol, STABLE.decimals);
      await funds.connect(operator).registerFund(fund, { ...FUND_CREATION_TX, txHash: "" }, []);

      const chain = (await funds.getFund(fund.fundId)).chain;
      expect(chain.chainId).to.equal(XRPL_CHAIN);
      expect(chain.network).to.equal("xrpl:testnet");
      expect(chain.name).to.equal("XRPL");
      expect(chain.networkChainId).to.equal("");
      expect(chain.profileId).to.equal("");
      expect(chain.genesisHash).to.equal(ZERO_HASH);
    });

    it("returns the fundKey", async function () {
      const { funds, operator } = await loadFixture(deployFixture);
      const returned = await funds.connect(operator).registerFund.staticCall(FUND, { ...FUND_CREATION_TX, txHash: "" }, []);
      expect(returned).to.equal(keyOf(FUND.fundId));
    });

    it("registers the creation transaction in MultiChainTxRegistry when a txHash is given", async function () {
      const { funds, txRegistry, operator } = await loadFixture(deployFixture);
      const fundKey = keyOf(FUND.fundId);

      const tx = funds.connect(operator).registerFund(FUND, FUND_CREATION_TX, []);
      await expect(tx).to.emit(funds, "FundCreationTxLinked").withArgs(fundKey, 1n);
      await expect(tx)
        .to.emit(txRegistry, "TxRegistered")
        .withArgs(1n, XDC_CHAIN, FUND_CREATION_TX.txHash, await funds.getAddress());

      const f = await funds.getFund(FUND.fundId);
      expect(f.creationTxId).to.equal(1n);
      expect(f.creationTxHash).to.equal(FUND_CREATION_TX.txHash);

      const stored = await txRegistry.getTx(1);
      expect(stored.chainId).to.equal(XDC_CHAIN);
      expect(stored.txHash).to.equal(FUND_CREATION_TX.txHash);
      expect(stored.blockNumber).to.equal(FUND_CREATION_TX.blockNumber);
      expect(stored.registeredBy).to.equal(await funds.getAddress());
    });

    it("passes the extra args through to MultiChainTxRegistry", async function () {
      const { funds, txRegistry, operator } = await loadFixture(deployFixture);
      await txRegistry.registerSchemaKey("eip155:51", key("logIndex"), "uint256", "", true);

      // missing required key bubbles up from the registry
      await expect(funds.connect(operator).registerFund(FUND, FUND_CREATION_TX, [])).to.be.revertedWith("Missing required extra arg");

      const args = [{ key: key("logIndex"), value: abi.encode(["uint256"], [7]) }];
      await funds.connect(operator).registerFund(FUND, FUND_CREATION_TX, args);

      const stored = await txRegistry.getExtraArgs(1);
      expect(stored.length).to.equal(1);
      expect(abi.decode(["uint256"], stored[0].value)[0]).to.equal(7n);
    });

    it("rejects a duplicated fund, even with a differently cased id", async function () {
      const { funds, operator } = await loadFixture(fundFixture);

      await expect(funds.connect(operator).registerFund(FUND, { ...FUND_CREATION_TX, txHash: "" }, []))
        .to.be.revertedWith("Fund already registered");
      await expect(
        funds.connect(operator).registerFund({ ...FUND, fundId: FUND.fundId.toUpperCase() }, { ...FUND_CREATION_TX, txHash: "" }, []),
      ).to.be.revertedWith("Fund already registered");
    });

    it("rejects an empty fundId", async function () {
      const { funds, operator } = await loadFixture(deployFixture);
      await expect(
        funds.connect(operator).registerFund({ ...FUND, fundId: "" }, { ...FUND_CREATION_TX, txHash: "" }, []),
      ).to.be.revertedWith("Empty id");
    });

    it("rejects a chain that is not registered in MultiChainTxRegistry", async function () {
      const { funds, operator } = await loadFixture(deployFixture);
      await expect(
        funds.connect(operator).registerFund({ ...FUND, chainId: keyOf("eip155:1") }, { ...FUND_CREATION_TX, txHash: "" }, []),
      ).to.be.revertedWith("Chain not registered");
    });

    it("rejects a zero contract address", async function () {
      const { funds, operator } = await loadFixture(deployFixture);
      await expect(
        funds.connect(operator).registerFund({ ...FUND, contractAddress: ethers.ZeroAddress }, { ...FUND_CREATION_TX, txHash: "" }, []),
      ).to.be.revertedWith("Zero fund contract");
    });

    it("rejects a stablecoin that is not registered", async function () {
      const { funds, operator, other } = await loadFixture(deployFixture);
      const noCreationTx = { ...FUND_CREATION_TX, txHash: "" };

      await expect(
        funds.connect(operator).registerFund({ ...FUND, stableAddress: other.address }, noCreationTx, []),
      ).to.be.revertedWith("Stable not registered");
      await expect(
        funds.connect(operator).registerFund({ ...FUND, stableAddress: ethers.ZeroAddress }, noCreationTx, []),
      ).to.be.revertedWith("Stable not registered");
    });

    it("rejects a stablecoin registered only on another chain", async function () {
      const { funds, operator } = await loadFixture(deployFixture);

      // BRL-CVM exists on XDC, but the fund is on XRPL
      await expect(
        funds.connect(operator).registerFund({ ...FUND, chainId: XRPL_CHAIN }, { ...FUND_CREATION_TX, txHash: "" }, []),
      ).to.be.revertedWith("Stable not registered");
    });

    it("lets several funds share the same stablecoin", async function () {
      const { funds, operator } = await loadFixture(deployFixture);
      const noCreationTx = { ...FUND_CREATION_TX, txHash: "" };

      await funds.connect(operator).registerFund(FUND, noCreationTx, []);
      await funds.connect(operator).registerFund(FUND2, noCreationTx, []);

      const key = stableKeyOf(STABLE.chainId, STABLE.tokenAddress);
      expect((await funds.getFund(FUND.fundId)).stable.stableKey).to.equal(key);
      expect((await funds.getFund(FUND2.fundId)).stable.stableKey).to.equal(key);
      expect(await funds.getStableCoinCount()).to.equal(1n);
    });

    it("rejects non-operator callers, including the owner", async function () {
      const { funds, owner, other } = await loadFixture(deployFixture);
      await expect(funds.connect(owner).registerFund(FUND, FUND_CREATION_TX, [])).to.be.revertedWithCustomError(funds, "AccessControlUnauthorizedAccount");
      await expect(funds.connect(other).registerFund(FUND, FUND_CREATION_TX, [])).to.be.revertedWithCustomError(funds, "AccessControlUnauthorizedAccount");
    });

    it("reverts when the contract is not a relayer of MultiChainTxRegistry", async function () {
      const { funds, txRegistry, operator } = await loadFixture(deployFixture);
      await txRegistry.revokeRole(RELAYER_ROLE, await funds.getAddress());

      await expect(funds.connect(operator).registerFund(FUND, FUND_CREATION_TX, [])).to.be.revertedWithCustomError(funds, "AccessControlUnauthorizedAccount");
      // without a creation tx the registry is not called, so it still works
      await expect(funds.connect(operator).registerFund(FUND, { ...FUND_CREATION_TX, txHash: "" }, [])).to.not.revert(ethers);
    });
  });

  describe("recordFundCreationTx", function () {
    it("links the creation transaction later", async function () {
      const { funds, txRegistry, operator, fundKey } = await loadFixture(fundFixture);

      await expect(funds.connect(operator).recordFundCreationTx(FUND.fundId, FUND_CREATION_TX, []))
        .to.emit(funds, "FundCreationTxLinked")
        .withArgs(fundKey, 1n);

      const f = await funds.getFund(FUND.fundId);
      expect(f.creationTxId).to.equal(1n);
      expect(f.creationTxHash).to.equal(FUND_CREATION_TX.txHash);
      expect((await txRegistry.getTx(1)).chainId).to.equal(FUND.chainId);
    });

    it("rejects linking twice", async function () {
      const { funds, operator, fundKey } = await loadFixture(fundFixture);
      await funds.connect(operator).recordFundCreationTx(FUND.fundId, FUND_CREATION_TX, []);

      await expect(
        funds.connect(operator).recordFundCreationTx(FUND.fundId, { ...FUND_CREATION_TX, txHash: "0xabc" }, []),
      ).to.be.revertedWith("Creation tx already linked");
    });

    it("rejects an unknown fund", async function () {
      const { funds, operator } = await loadFixture(fundFixture);
      await expect(funds.connect(operator).recordFundCreationTx("nope", FUND_CREATION_TX, [])).to.be.revertedWith("Unknown fund");
    });

    it("rejects non-operator callers", async function () {
      const { funds, other, fundKey } = await loadFixture(fundFixture);
      await expect(funds.connect(other).recordFundCreationTx(FUND.fundId, FUND_CREATION_TX, [])).to.be.revertedWithCustomError(funds, "AccessControlUnauthorizedAccount");
    });
  });

  describe("View functions", function () {
    it("getFund rejects an unknown fund", async function () {
      const { funds } = await loadFixture(deployFixture);
      await expect(funds.getFund("nope")).to.be.revertedWith("Unknown fund");
    });

    it("finds the fund by its fundId as text, ignoring case and whitespace", async function () {
      const { funds, operator } = await loadFixture(fundFixture);
      const variant = " " + FUND.fundId.toUpperCase() + "\t";

      expect((await funds.getFund(variant)).fundId).to.equal(FUND.fundId);

      await funds.connect(operator).recordFundCreationTx(variant, FUND_CREATION_TX, []);
      expect((await funds.getFund(FUND.fundId)).creationTxId).to.equal(1n);
    });

    describe("listFunds", function () {
      const IDS = ["fund-a", "fund-b", "fund-c", "fund-d"];

      /// deployFixture plus four funds registered in the order of IDS.
      async function fourFundsFixture() {
        const base = await deployFixture();
        const { funds, operator } = base;

        for (const [i, fundId] of IDS.entries()) {
          await funds.connect(operator).registerFund(
            { ...FUND, fundId, fidcId: BigInt(i + 1) },
            { ...FUND_CREATION_TX, txHash: "" },
            [],
          );
        }
        return base;
      }

      const ids = (list: { fundId: string }[]) => list.map((f) => f.fundId);

      it("returns an empty list while there are no funds", async function () {
        const { funds } = await loadFixture(deployFixture);
        expect(await funds.listFunds(0, 0)).to.deep.equal([]);
        expect(await funds.listFunds(0, 5)).to.deep.equal([]);
      });

      it("lists every fund with toIndex 0", async function () {
        const { funds } = await loadFixture(fourFundsFixture);
        expect(ids(await funds.listFunds(0, 0))).to.deep.equal(IDS);
      });

      it("lists from fromIndex up to the last fund with toIndex 0", async function () {
        const { funds } = await loadFixture(fourFundsFixture);
        expect(ids(await funds.listFunds(2, 0))).to.deep.equal(["fund-c", "fund-d"]);
        expect(ids(await funds.listFunds(3, 0))).to.deep.equal(["fund-d"]);
      });

      it("treats toIndex as exclusive", async function () {
        const { funds } = await loadFixture(fourFundsFixture);
        expect(ids(await funds.listFunds(0, 1))).to.deep.equal(["fund-a"]);
        expect(ids(await funds.listFunds(1, 3))).to.deep.equal(["fund-b", "fund-c"]);
        expect(ids(await funds.listFunds(0, 4))).to.deep.equal(IDS);
      });

      it("clamps a toIndex above the fund count", async function () {
        const { funds } = await loadFixture(fourFundsFixture);
        expect(ids(await funds.listFunds(1, 100))).to.deep.equal(["fund-b", "fund-c", "fund-d"]);
      });

      it("returns an empty list for a range with no funds", async function () {
        const { funds } = await loadFixture(fourFundsFixture);
        expect(await funds.listFunds(4, 0)).to.deep.equal([]);   // fromIndex at the end
        expect(await funds.listFunds(9, 0)).to.deep.equal([]);   // fromIndex past the end
        expect(await funds.listFunds(2, 2)).to.deep.equal([]);   // empty range
        expect(await funds.listFunds(3, 1)).to.deep.equal([]);   // inverted range
      });

      it("returns the complete Fund struct of each entry", async function () {
        const { funds } = await loadFixture(fourFundsFixture);

        const [fund] = await funds.listFunds(1, 2);
        expect(fund.fundKey).to.equal(keyOf("fund-b"));
        expect(fund.fundId).to.equal("fund-b");
        expect(fund.fidcId).to.equal(2n);
        expect(fund.name).to.equal(FUND.name);
        expect(fund.chain.chainId).to.equal(FUND.chainId);
        expect(fund.chain.network).to.equal(CHAINS[0].network);
        expect(fund.contractAddress).to.equal(FUND.contractAddress);
        expect(fund.stable.symbol).to.equal(STABLE.symbol);
        expect(fund.createdAt).to.equal(FUND.createdAt);
      });
    });

    it("getFundRef returns the fields OrderRegistry checks an intent against", async function () {
      const { funds } = await loadFixture(fundFixture);

      const [fundKey, chainId, contractAddress, stableAddress] = await funds.getFundRef(FUND.fundId);
      expect(fundKey).to.equal(keyOf(FUND.fundId));
      expect(chainId).to.equal(FUND.chainId);
      expect(contractAddress).to.equal(FUND.contractAddress);
      expect(stableAddress).to.equal(FUND.stableAddress);
    });

    it("getFundRef rejects an unknown fund", async function () {
      const { funds } = await loadFixture(deployFixture);
      await expect(funds.getFundRef("nope")).to.be.revertedWith("Unknown fund");
    });

    it("rejects an empty fundId in every fund function", async function () {
      const { funds, operator } = await loadFixture(fundFixture);

      await expect(funds.getFund("")).to.be.revertedWith("Empty id");
      await expect(funds.getFundRef(" ")).to.be.revertedWith("Empty id");
      await expect(funds.connect(operator).recordFundCreationTx("", FUND_CREATION_TX, [])).to.be.revertedWith("Empty id");
    });
  });
});
