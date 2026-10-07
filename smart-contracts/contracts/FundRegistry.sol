// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {RegistryBase} from "./RegistryBase.sol";
import {MultiChainTxRegistry} from "./MultiChainTxRegistry.sol";
import {ChainInfo, TxInput, ExtraArg} from "./MultiChainTypes.sol";

/// @title FundRegistry
/// @notice Stores stablecoins and funds (FIDCs / debentures). The creation
///         transaction of a fund is registered in MultiChainTxRegistry, and only
///         its internal id is kept here. Orders live in OrderRegistry.
/// @dev    This contract must be enabled as a relayer in MultiChainTxRegistry
///         (txRegistry.grantRole(RELAYER_ROLE, address(this))).
contract FundRegistry is RegistryBase {

    // ============================================================
    // STABLECOIN (cash token of the funds)
    // ============================================================

    /// @dev A stablecoin is a token on one chain, identified by (chainId, tokenAddress).
    ///      The same symbol may exist on several chains, each one with its own entry.
    ///      Seen so far: BRL-CVM (eip155:51), BRL1 (eip155:80002), BRL-CVM-DEV (eip155:50).
    struct StableCoin {
        bytes32 stableKey;      // keccak256(abi.encode(chainId, tokenAddress))
        bytes32 chainId;        // registry chainId: keccak256("eip155:51")
        address tokenAddress;   // token contract (stableAddress of fund.json)
        string  symbol;         // "BRL-CVM", "BRL1", "BRL-CVM-DEV"
        uint8   decimals;       // 18
    }

    // ============================================================
    // FUND
    // ============================================================

    /// @dev chainId / network / profileId / genesisHash of the JSON are kept in
    ///      `chain`, a copy of the ChainInfo (MultiChainTypes.sol) taken when the
    ///      fund is registered. A registered chain never changes in the registry,
    ///      so the copy cannot go stale. The same applies to `stable`, a copy of the
    ///      StableCoin registered for (chainId, stableAddress).
    struct Fund {
        bytes32 fundKey;             // keccak256(bytes(normalized fundId))
        string  fundId;              // UUID: "be6f2e8a-5474-43c7-a692-7918c37e3f42"
        uint256 fidcId;              // "2"
        string  name;                // "Horizonte Credito Multirrede FIDC - Piloto XDC"
        ChainInfo chain;             // chain.chainId = keccak256("eip155:51")
        address contractAddress;     // fund contract on the source chain
        StableCoin stable;           // cash token: stable.symbol = "BRL-CVM"
        bytes32 creationIntentHash;  // 0x8dc7...
        string  creationTxHash;      // 0x1462...
        uint256 creationTxId;        // id in MultiChainTxRegistry (0 = not registered yet)
        uint256 createdAt;           // unix time of fund.createdAt
    }

    struct FundInput {
        string  fundId;
        uint256 fidcId;
        string  name;
        bytes32 chainId;             // must be registered in MultiChainTxRegistry
        address contractAddress;
        address stableAddress;       // must be a StableCoin registered on chainId
        bytes32 creationIntentHash;
        uint256 createdAt;
    }

    // ============================================================
    // STORAGE
    // ============================================================

    mapping(bytes32 => StableCoin) private _stableCoins;   // stableKey => StableCoin
    bytes32[] public stableCoinKeys;

    mapping(bytes32 => Fund) private _funds;
    bytes32[] public fundKeys;

    // ============================================================
    // EVENTS
    // ============================================================

    event StableCoinRegistered(
        bytes32 indexed stableKey,
        bytes32 indexed chainId,
        address indexed tokenAddress,
        string  symbol,
        uint8   decimals
    );
    event FundRegistered(bytes32 indexed fundKey, string fundId, uint256 fidcId, bytes32 indexed chainId);
    event FundCreationTxLinked(bytes32 indexed fundKey, uint256 indexed txId);

    constructor(MultiChainTxRegistry registry) RegistryBase(registry) {}

    // ============================================================
    // STABLECOINS
    // ============================================================

    /// @notice Storage key of a stablecoin: keccak256(abi.encode(chainId, tokenAddress)).
    function stableCoinKeyOf(bytes32 chainId, address tokenAddress) public pure returns (bytes32) {
        return keccak256(abi.encode(chainId, tokenAddress));
    }

    /// @notice Registers a stablecoin on a chain registered in MultiChainTxRegistry.
    ///         It must be registered before the funds that use it.
    function registerStableCoin(
        bytes32 chainId,
        address tokenAddress,
        string calldata symbol,
        uint8 decimals
    ) external onlyOperator returns (bytes32 stableKey) {
        _requireChain(chainId);
        require(tokenAddress != address(0), "Zero stable");
        require(bytes(symbol).length != 0, "Empty symbol");

        stableKey = stableCoinKeyOf(chainId, tokenAddress);
        require(_stableCoins[stableKey].stableKey == bytes32(0), "Stable already registered");

        _stableCoins[stableKey] = StableCoin(stableKey, chainId, tokenAddress, symbol, decimals);
        stableCoinKeys.push(stableKey);

        emit StableCoinRegistered(stableKey, chainId, tokenAddress, symbol, decimals);
    }

    // ============================================================
    // FUNDS
    // ============================================================

    /// @notice Registers a fund. If creationTx.txHash is not empty, the creation
    ///         transaction is registered in MultiChainTxRegistry on the fund's chain.
    function registerFund(
        FundInput calldata f,
        TxInput calldata creationTx,
        ExtraArg[] calldata creationExtraArgs
    ) external onlyOperator returns (bytes32 fundKey) {
        fundKey = keyOf(f.fundId);
        require(_funds[fundKey].fundKey == bytes32(0), "Fund already registered");
        ChainInfo memory chain = _chainInfo(f.chainId);
        require(f.contractAddress != address(0), "Zero fund contract");
        StableCoin storage stable = _requireStableCoin(f.chainId, f.stableAddress);

        Fund storage s = _funds[fundKey];
        s.fundKey            = fundKey;
        s.fundId             = f.fundId;
        s.fidcId             = f.fidcId;
        s.name               = f.name;
        s.chain              = chain;
        s.contractAddress    = f.contractAddress;
        s.stable             = stable;
        s.creationIntentHash = f.creationIntentHash;
        s.createdAt          = f.createdAt;
        fundKeys.push(fundKey);

        emit FundRegistered(fundKey, f.fundId, f.fidcId, f.chainId);

        if (bytes(creationTx.txHash).length != 0) {
            _linkFundCreationTx(s, creationTx, creationExtraArgs);
        }
    }

    /// @notice Registers the fund creation transaction later (e.g. after fetching block data).
    function recordFundCreationTx(
        string calldata fundId,
        TxInput calldata creationTx,
        ExtraArg[] calldata extraArgs
    ) external onlyOperator returns (uint256 txId) {
        Fund storage s = _requireFund(keyOf(fundId));
        require(s.creationTxId == 0, "Creation tx already linked");
        return _linkFundCreationTx(s, creationTx, extraArgs);
    }

    function _linkFundCreationTx(
        Fund storage s,
        TxInput calldata t,
        ExtraArg[] calldata extraArgs
    ) private returns (uint256 txId) {
        txId = txRegistry.registerTx(s.chain.chainId, t, extraArgs);
        s.creationTxId   = txId;
        s.creationTxHash = t.txHash;
        emit FundCreationTxLinked(s.fundKey, txId);
    }

    // ============================================================
    // INTERNAL HELPERS
    // ============================================================

    /// @dev Reads the ChainInfo of a registered chain from MultiChainTxRegistry.
    function _chainInfo(bytes32 chainId)
        private
        view
        returns (ChainInfo memory info)
    {
        (
            info.chainId,
            info.network,
            info.networkChainId,
            info.name,
            info.profileId,
            info.genesisHash
        ) = txRegistry.chains(chainId);
        require(info.chainId != bytes32(0), "Chain not registered");
    }

    function _requireStableCoin(bytes32 chainId, address tokenAddress)
        private
        view
        returns (StableCoin storage c)
    {
        c = _stableCoins[stableCoinKeyOf(chainId, tokenAddress)];
        require(c.stableKey != bytes32(0), "Stable not registered");
    }

    function _requireFund(bytes32 fundKey) private view returns (Fund storage f) {
        f = _funds[fundKey];
        require(f.fundKey != bytes32(0), "Unknown fund");
    }

    // ============================================================
    // VIEW FUNCTIONS
    // ============================================================

    function getStableCoin(bytes32 chainId, address tokenAddress)
        external
        view
        returns (StableCoin memory)
    {
        return _requireStableCoin(chainId, tokenAddress);
    }

    function getStableCoinCount() external view returns (uint256) {
        return stableCoinKeys.length;
    }

    /// @notice All registered stablecoins, in registration order.
    function listStableCoins() external view returns (StableCoin[] memory list) {
        list = new StableCoin[](stableCoinKeys.length);
        for (uint256 i = 0; i < list.length; i++) {
            list[i] = _stableCoins[stableCoinKeys[i]];
        }
    }

    function getFund(string calldata fundId) external view returns (Fund memory) {
        return _requireFund(keyOf(fundId));
    }

    function getFundCount() external view returns (uint256) {
        return fundKeys.length;
    }

    /// @notice Funds in registration order, from fromIndex (inclusive) to toIndex (exclusive).
    /// @param fromIndex position of the first fund to return (0 = first registered).
    /// @param toIndex   position after the last fund to return. 0 lists up to the last
    ///                  fund; a value above the fund count is treated as the fund count.
    /// @dev listFunds(0, 0) returns every fund, listFunds(0, 1) only the first one and
    ///      listFunds(2, 5) the funds at positions 2, 3 and 4. A range with no funds
    ///      returns an empty list.
    function listFunds(uint256 fromIndex, uint256 toIndex) external view returns (Fund[] memory list) {
        uint256 count = fundKeys.length;
        if (toIndex == 0 || toIndex > count) toIndex = count;
        if (fromIndex >= toIndex) return list;

        list = new Fund[](toIndex - fromIndex);
        for (uint256 i = fromIndex; i < toIndex; i++) {
            list[i - fromIndex] = _funds[fundKeys[i]];
        }
    }

    /// @notice The fields of a fund that OrderRegistry checks an order intent against.
    /// @dev Cheaper than getFund for contract-to-contract calls: no strings are copied.
    ///      Reverts with "Unknown fund" if the fund is not registered.
    function getFundRef(string calldata fundId)
        external
        view
        returns (bytes32 fundKey, bytes32 chainId, address contractAddress, address stableAddress)
    {
        Fund storage f = _requireFund(keyOf(fundId));
        return (f.fundKey, f.chain.chainId, f.contractAddress, f.stable.tokenAddress);
    }
}
