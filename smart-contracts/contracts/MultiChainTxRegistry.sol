// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {AdminProtected} from "./AdminProtected.sol";
import {ChainInfo, TxStatus, BaseTx, TxInput, ExtraArg, ExtraArgSchema} from "./MultiChainTypes.sol";

contract MultiChainTxRegistry is AdminProtected {

    /// @dev ChainInfo, TxStatus, BaseTx, TxInput, ExtraArg and ExtraArgSchema
    ///      live in MultiChainTypes.sol.

    // ============================================================
    // STORAGE
    // ============================================================

    uint256 public txCount;

    // chainId => ChainInfo (chainId = keccak256(bytes(normalized network)))
    mapping(bytes32 => ChainInfo) public chains;
    bytes32[] public chainIds;

    // internal ID => base data (read through getTx)
    mapping(uint256 => BaseTx) private _baseTxs;

    // internal ID => network-specific extra arguments
    mapping(uint256 => ExtraArg[]) private _extraArgs;

    // keccak256(chainId, normalized txHash) => internal ID (0 = not registered)
    mapping(bytes32 => uint256) public txIndex;

    // Lookups
    mapping(bytes32 => uint256[]) public txIdsByChain;    // chainId => ids
    mapping(bytes32 => uint256[]) public txIdsByAddress;  // keccak256(bytes(address)) => ids

    // chainId => list of allowed extra arg keys
    mapping(bytes32 => ExtraArgSchema[]) private _schemas;

    // keccak256(chainId, key) => index + 1 in _schemas (0 = does not exist)
    mapping(bytes32 => uint256) private _schemaIndex;

    // ============================================================
    // ACCESS CONTROL
    // ============================================================

    /// @dev Roles come from OpenZeppelin AccessControl, through AdminProtected:
    ///      - DEFAULT_ADMIN_ROLE (the deployer): registers chains and schema keys, and
    ///        manages the relayers with grantRole / revokeRole(RELAYER_ROLE, account).
    ///      - RELAYER_ROLE: registers transactions and updates their status.
    ///      Unauthorized calls revert with AccessControlUnauthorizedAccount(account, role).
    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");

    modifier onlyRelayer() {
        _checkRole(RELAYER_ROLE);
        _;
    }

    // ============================================================
    // EVENTS
    // ============================================================

    event ChainRegistered(
        bytes32 indexed chainId,
        string  network,          // normalized
        string  networkChainId,   // textual chain id (e.g. "51")
        string  name,
        string  profileId,
        bytes32 genesisHash
    );

    event TxRegistered(
        uint256 indexed id,
        bytes32 indexed chainId,
        string  txHash,
        address indexed registeredBy
    );

    event TxStatusUpdated(uint256 indexed id, TxStatus newStatus);

    event SchemaKeyRegistered(
        bytes32 indexed chainId,
        string  network,
        bytes32 key,
        string  valueType,
        bool    required
    );

    event SchemaKeyStatusUpdated(
        bytes32 indexed chainId,
        bytes32 indexed key,
        bool    active
    );

    // ============================================================
    // NORMALIZATION
    // ============================================================

    /// @dev Lowercases A-Z and removes space, tab, LF and CR. ASCII only.
    function _normalize(string memory s) internal pure returns (string memory) {
        bytes memory b   = bytes(s);
        bytes memory out = new bytes(b.length);
        uint256 n = 0;

        for (uint256 i = 0; i < b.length; i++) {
            bytes1 c = b[i];

            if (c == 0x20 || c == 0x09 || c == 0x0A || c == 0x0D) continue;
            if (c >= 0x41 && c <= 0x5A) c = bytes1(uint8(c) + 32);

            out[n++] = c;
        }

        assembly { mstore(out, n) } // trim to the real length
        return string(out);
    }

    /// @notice Pure helper so callers can preview the chainId of a network string.
    function computeChainId(string calldata network) external pure returns (bytes32) {
        return keccak256(bytes(_normalize(network)));
    }

    // ============================================================
    // CHAIN MANAGEMENT
    // ============================================================

    /// @notice Registers a chain. The network is normalized (lowercase, no whitespace)
    ///         and chainId = keccak256(bytes(normalized network)).
    function registerChain(
        string calldata network,
        string calldata networkChainId,
        string calldata name,
        string calldata profileId,
        bytes32 genesisHash
    ) external onlyAdmin returns (bytes32 chainId) {
        string memory net = _normalize(network);
        require(bytes(net).length != 0 && bytes(net).length <= 64, "Invalid network");

        chainId = keccak256(bytes(net));
        require(chains[chainId].chainId == bytes32(0), "Chain already registered");

        chains[chainId] = ChainInfo(chainId, net, networkChainId, name, profileId, genesisHash);
        chainIds.push(chainId);

        emit ChainRegistered(chainId, net, networkChainId, name, profileId, genesisHash);
    }

    // ============================================================
    // SCHEMA MANAGEMENT
    // ============================================================

    /// @notice Registers an allowed extra arg key for a network (must be a registered chain).
    function registerSchemaKey(
        string calldata network,
        bytes32 key,
        string calldata valueType,
        string calldata description,
        bool required
    ) external onlyAdmin {
        require(key != bytes32(0), "Empty key");

        string memory net = _normalize(network);
        bytes32 chainId   = keccak256(bytes(net));
        require(chains[chainId].chainId != bytes32(0), "Chain not registered");

        bytes32 schemaKey = _schemaKey(chainId, key);
        require(_schemaIndex[schemaKey] == 0, "Key already registered");

        _schemas[chainId].push(
            ExtraArgSchema(key, valueType, description, required, true)
        );
        _schemaIndex[schemaKey] = _schemas[chainId].length;

        emit SchemaKeyRegistered(chainId, net, key, valueType, required);
    }

    /// @notice Activates or deprecates an existing schema key.
    function setSchemaKeyActive(
        string calldata network,
        bytes32 key,
        bool active
    ) external onlyAdmin {
        bytes32 chainId = keccak256(bytes(_normalize(network)));
        uint256 idx = _schemaIndex[_schemaKey(chainId, key)];
        require(idx != 0, "Key not registered");

        _schemas[chainId][idx - 1].active = active;

        emit SchemaKeyStatusUpdated(chainId, key, active);
    }

    // ============================================================
    // TRANSACTION REGISTRATION
    // ============================================================

    /// @notice Registers a transaction observed on a registered chain.
    /// @param chainId keccak256 of the normalized network (see computeChainId).
    function registerTx(
        bytes32 chainId,
        TxInput calldata t,
        ExtraArg[] calldata extraArgs
    ) external onlyRelayer returns (uint256 id) {
        require(chains[chainId].chainId != bytes32(0), "Chain not registered");
        require(bytes(t.txHash).length != 0, "Empty txHash");

        // duplicate protection (txHash normalized: hex case differs between networks)
        bytes32 idxKey = keccak256(abi.encodePacked(chainId, _normalize(t.txHash)));
        require(txIndex[idxKey] == 0, "Tx already registered");

        _validateExtraArgs(chainId, extraArgs);

        id = ++txCount;
        txIndex[idxKey] = id;

        BaseTx storage b = _baseTxs[id];
        b.id           = id;
        b.chainId      = chainId;
        b.status       = t.status;
        b.txHash       = t.txHash;
        b.from         = t.from;
        b.to           = t.to;
        b.amount       = t.amount;
        b.assetCode    = t.assetCode;
        b.assetIssuer  = t.assetIssuer;
        b.txType       = t.txType;
        b.data         = t.data;
        b.dataType     = t.dataType;
        b.blockNumber  = t.blockNumber;
        b.timestamp    = t.timestamp;
        b.registeredAt = block.timestamp;
        b.registeredBy = msg.sender;

        for (uint256 i = 0; i < extraArgs.length; i++) {
            _extraArgs[id].push(extraArgs[i]);
        }

        txIdsByChain[chainId].push(id);
        txIdsByAddress[keccak256(bytes(t.from))].push(id);
        if (keccak256(bytes(t.to)) != keccak256(bytes(t.from))) {
            txIdsByAddress[keccak256(bytes(t.to))].push(id);
        }

        emit TxRegistered(id, chainId, t.txHash, msg.sender);
    }

    /// @notice Updates the status of a registered transaction (e.g. PENDING -> CONFIRMED).
    function updateTxStatus(uint256 id, TxStatus newStatus) external onlyRelayer {
        require(id != 0 && id <= txCount, "Unknown tx");
        _baseTxs[id].status = newStatus;
        emit TxStatusUpdated(id, newStatus);
    }

    // ============================================================
    // VALIDATION
    // ============================================================

    /// @dev Reverts if args contain unknown, deprecated or duplicated keys,
    ///      or if any required key is missing.
    function _validateExtraArgs(
        bytes32 chainId,
        ExtraArg[] calldata args
    ) internal view {
        ExtraArgSchema[] storage schema = _schemas[chainId];

        // 1. Every key sent must exist, be active and appear only once
        for (uint256 i = 0; i < args.length; i++) {
            uint256 idx = _schemaIndex[_schemaKey(chainId, args[i].key)];
            require(idx != 0, "Unknown extra arg key");
            require(schema[idx - 1].active, "Extra arg key deprecated");

            for (uint256 d = i + 1; d < args.length; d++) {
                require(args[d].key != args[i].key, "Duplicated extra arg key");
            }
        }

        // 2. Every required and active key must be present
        for (uint256 j = 0; j < schema.length; j++) {
            if (!schema[j].required || !schema[j].active) continue;

            bool found = false;
            for (uint256 k = 0; k < args.length; k++) {
                if (args[k].key == schema[j].key) {
                    found = true;
                    break;
                }
            }
            require(found, "Missing required extra arg");
        }
    }

    function _schemaKey(bytes32 chainId, bytes32 key) private pure returns (bytes32) {
        return keccak256(abi.encodePacked(chainId, key));
    }

    // ============================================================
    // VIEW FUNCTIONS
    // ============================================================

    /// @notice Returns the base data of a transaction (the auto-generated public getter
    ///         of a 16-field struct hits "stack too deep", so it is exposed as a struct).
    function getTx(uint256 id) external view returns (BaseTx memory) {
        require(id != 0 && id <= txCount, "Unknown tx");
        return _baseTxs[id];
    }

    function getExtraArgs(uint256 id) external view returns (ExtraArg[] memory) {
        return _extraArgs[id];
    }

    function getExtraArgsLength(uint256 id) external view returns (uint256) {
        return _extraArgs[id].length;
    }

    function getSchema(string calldata network)
        external
        view
        returns (ExtraArgSchema[] memory)
    {
        return _schemas[keccak256(bytes(_normalize(network)))];
    }

    function getChainCount() external view returns (uint256) {
        return chainIds.length;
    }
}
