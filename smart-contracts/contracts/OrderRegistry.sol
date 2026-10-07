// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {RegistryBase} from "./RegistryBase.sol";
import {FundRegistry} from "./FundRegistry.sol";
import {MultiChainTxRegistry} from "./MultiChainTxRegistry.sol";
import {TxStatus, BaseTx, TxInput, ExtraArg} from "./MultiChainTypes.sol";

/// @title OrderRegistry
/// @notice Stores the orders of the funds registered in FundRegistry. Every
///         on-chain transaction of an order is registered in MultiChainTxRegistry,
///         and only its internal id is kept here.
/// @dev    This contract must be enabled as a relayer in MultiChainTxRegistry
///         (txRegistry.grantRole(RELAYER_ROLE, address(this))).
contract OrderRegistry is RegistryBase {

    // ============================================================
    // ENUMS
    // ============================================================

    /// @dev Values observed in order.progress.
    enum OrderProgress {
        AWAITING_ORIGIN,
        AWAITING_DELIVERY,
        ACQUIRED_WITH_LOCK
    }

    // ============================================================
    // ORDER TX ROLE
    // ============================================================

    /// @dev What a transaction of an order does. Roles are registered by the admin,
    ///      so new ones can be added without redeploying. An order may have any
    ///      number of transactions of each role (retries, partial deliveries...).
    ///      Registered at deploy: TRANSFER, LOCK (source chain) and DELIVERY
    ///      (destination chain).
    struct OrderTxRole {
        bytes32 role;                // e.g. bytes32("TRANSFER"), bytes32("REFUND")
        string  description;         // e.g. "Cash token sent to the order escrow"
        bool    onDestinationChain;  // false: intent.sourceChainId | true: intent.destinationChainId
        bool    active;              // allows deprecating a role without deleting it
    }

    // ============================================================
    // ORDER TX DISPOSITION
    // ============================================================

    /// @dev What a transaction did for the order: the `disposition` of sourceEvidence /
    ///      destinationEvidence. Dispositions are registered by the admin, so new ones
    ///      can be added without redeploying. Registered at deploy: LOCKED (transfer to
    ///      the escrow) and DELIVERED (delivery on the destination chain).
    ///      bytes32(0) means "no disposition" (e.g. the lock acknowledgment) and is
    ///      always accepted; it is not an entry of this list.
    struct OrderTxDisposition {
        bytes32 disposition;  // e.g. bytes32("LOCKED"), bytes32("REFUNDED")
        string  description;  // e.g. "Cash token locked in the order escrow"
        bool    active;       // allows deprecating a disposition without deleting it
    }

    // ============================================================
    // ORDER 
    // ============================================================

    /// @dev The intent is what was asked for: which token, for whom, between which
    ///      chains and until when. It is written once, when the order is registered,
    ///      and no function changes it afterwards.
    ///      Source: items[].intent. Only the fields below are kept on-chain; the
    ///      amounts, the escrow, the destination owner and the asset of an order are
    ///      in its transactions, stored in MultiChainTxRegistry.
    struct OrderIntent {
        string   orderId;               // intent.orderId: must match the orderId of the order
        address  cashToken;             // must equal the stablecoin of the fund
        uint64   validUntil;            // 1789324198
        address  beneficiary;
        bytes32  sourceChainId;         // keccak256("eip155:51"): must equal the chain of the fund
        address  sourceAccount;         // must equal the contract address of the fund
        bytes32  destinationChainId;    // keccak256("xrpl:testnet") / keccak256("stellar:testnet")
    }

    /// @dev The order is the identity and the current state: which fund it belongs
    ///      to, which step it is at, in which version, and when it was created and
    ///      last updated. Unlike the intent, it changes over time (updateOrderProgress).
    ///      Order and OrderIntent are one-to-one, stored under the same orderKey.
    ///      Source: items[] (id, intentHash, progress, version, createdAt, updatedAt).
    struct Order {
        bytes32       orderKey;             // keccak256(bytes(normalized orderId))
        string        orderId;              // UUID (items[].id == intent.orderId)
        bytes32       fundKey;              // owner fund (key in FundRegistry)
        bytes32       intentHash;           // items[].intentHash
        OrderProgress progress;
        uint32        version;              // items[].version (projection version)
        uint256       createdAt;
        uint256       updatedAt;
    }
    
    /// @dev One transaction of the order: connectorResults.{source|destination}
    ///      merged with {source|destination}Evidence, or the lock acknowledgment.
    ///      The transaction data itself (hash, from, to, amount, block...) is in
    ///      MultiChainTxRegistry. Each order keeps a list of these, in the order
    ///      they were recorded.
    struct OrderTx {
        string      orderId;       // order this transaction belongs to (filled by the contract)
        bytes32     role;          // registered OrderTxRole: bytes32("TRANSFER") / "LOCK" / "DELIVERY"
        bytes32     chainId;       // chain of the transaction (filled by the contract from the role)
        string      connectorId;   // "evm-cash-escrow", "xrpl", "stellar", "rayls"
        string      standard;      // "ERC20_TRANSFER_TO_ORDER_ESCROW", "XRPL_IOU", "STELLAR_CREDIT"
        bytes32     disposition;   // registered OrderTxDisposition: bytes32("LOCKED") / "DELIVERED"; 0 = none
        uint256     txId;          // id in MultiChainTxRegistry
    }

    /// @dev What a caller needs to know to decide which writes an order still needs.
    ///      Returned by getOrderSyncStates, many orders in one call.
    struct OrderSyncState {
        bool          registered;   // false: every other field is empty
        OrderProgress progress;
        uint32        version;
        uint256       createdAt;
        uint256       updatedAt;
        bytes32[]     roles;        // role of each transaction of the order, in the order they were recorded
    }

    struct OrderTxInput {
        string      connectorId;
        string      standard;
        bytes32     disposition;   // registered and active, or bytes32(0) for none
    }


    // ============================================================
    // STORAGE
    // ============================================================

    /// @notice Registry of the funds that own the orders.
    FundRegistry public immutable fundRegistry;

    mapping(bytes32 => Order)       private _orders;
    mapping(bytes32 => OrderIntent) private _intents;
    mapping(bytes32 => OrderTx[])   private _orderTxs;      // orderKey => transactions

    OrderTxRole[] private _roles;
    mapping(bytes32 => uint256) private _roleIndex;         // role => index + 1 in _roles (0 = does not exist)

    OrderTxDisposition[] private _dispositions;
    mapping(bytes32 => uint256) private _dispositionIndex;  // disposition => index + 1 in _dispositions (0 = does not exist)

    mapping(bytes32 => bytes32[]) private _ordersByFund;   // fundKey => orderKeys
    mapping(bytes32 => bytes32)   public  orderKeyByIntentHash;

    // ============================================================
    // EVENTS
    // ============================================================

    event OrderRegistered(bytes32 indexed orderKey, bytes32 indexed fundKey, string orderId, bytes32 intentHash);
    event OrderTxRoleRegistered(bytes32 indexed role, string description, bool onDestinationChain);
    event OrderTxRoleStatusUpdated(bytes32 indexed role, bool active);
    event OrderTxLinked(
        bytes32 indexed orderKey,
        uint256 index,
        bytes32 role,
        uint256 indexed txId,
        address operator
    );
    event OrderTxDispositionRegistered(bytes32 indexed disposition, string description);
    event OrderTxDispositionStatusUpdated(bytes32 indexed disposition, bool active);
    event OrderTxEvidenceUpdated(bytes32 indexed orderKey, uint256 index, bytes32 disposition);
    event OrderProgressUpdated(bytes32 indexed orderKey, OrderProgress progress, uint32 version);

    /// @param registry MultiChainTxRegistry where the transactions are registered.
    /// @param funds    FundRegistry of the funds; it must use the same MultiChainTxRegistry.
    constructor(MultiChainTxRegistry registry, FundRegistry funds) RegistryBase(registry) {
        require(address(funds) != address(0), "Zero fund registry");
        require(address(funds.txRegistry()) == address(registry), "Registry mismatch");
        fundRegistry = funds;

        _addOrderTxRole("TRANSFER", "Cash token sent to the order escrow", false);
        _addOrderTxRole("LOCK", "Lock acknowledgment on the source chain", false);
        _addOrderTxRole("DELIVERY", "Asset delivered to the destination owner", true);

        _addOrderTxDisposition("LOCKED", "Cash token locked in the order escrow");
        _addOrderTxDisposition("DELIVERED", "Asset delivered on the destination chain");
    }

    // ============================================================
    // ORDER TX ROLES
    // ============================================================

    /// @notice Registers a new role for the transactions of an order.
    /// @param role               short name as bytes32, e.g. bytes32("REFUND").
    /// @param onDestinationChain chain of the transactions of this role: false for the
    ///                           source chain of the order, true for the destination chain.
    function registerOrderTxRole(
        bytes32 role,
        string calldata description,
        bool onDestinationChain
    ) external onlyAdmin {
        _addOrderTxRole(role, description, onDestinationChain);
    }

    /// @notice Activates or deprecates a role. Transactions already recorded keep their role.
    function setOrderTxRoleActive(bytes32 role, bool active) external onlyAdmin {
        uint256 idx = _roleIndex[role];
        require(idx != 0, "Unknown role");
        _roles[idx - 1].active = active;
        emit OrderTxRoleStatusUpdated(role, active);
    }

    function _addOrderTxRole(bytes32 role, string memory description, bool onDestinationChain) private {
        require(role != bytes32(0), "Empty role");
        require(_roleIndex[role] == 0, "Role already registered");

        _roles.push(OrderTxRole(role, description, onDestinationChain, true));
        _roleIndex[role] = _roles.length;

        emit OrderTxRoleRegistered(role, description, onDestinationChain);
    }

    // ============================================================
    // ORDER TX DISPOSITIONS
    // ============================================================

    /// @notice Registers a new disposition for the transactions of an order.
    /// @param disposition short name as bytes32, e.g. bytes32("REFUNDED").
    function registerOrderTxDisposition(bytes32 disposition, string calldata description) external onlyAdmin {
        _addOrderTxDisposition(disposition, description);
    }

    /// @notice Activates or deprecates a disposition. Transactions that already have it keep it.
    function setOrderTxDispositionActive(bytes32 disposition, bool active) external onlyAdmin {
        uint256 idx = _dispositionIndex[disposition];
        require(idx != 0, "Unknown disposition");
        _dispositions[idx - 1].active = active;
        emit OrderTxDispositionStatusUpdated(disposition, active);
    }

    function _addOrderTxDisposition(bytes32 disposition, string memory description) private {
        require(disposition != bytes32(0), "Empty disposition");
        require(_dispositionIndex[disposition] == 0, "Disposition already registered");

        _dispositions.push(OrderTxDisposition(disposition, description, true));
        _dispositionIndex[disposition] = _dispositions.length;

        emit OrderTxDispositionRegistered(disposition, description);
    }

    // ============================================================
    // ORDERS
    // ============================================================

    /// @notice Registers an order (intent only). Its transactions are recorded
    ///         afterwards with recordOrderTx, as they are observed on each chain.
    /// @param fundId id of the owner fund in FundRegistry, as text (e.g. the UUID of fund.json).
    function registerOrder(
        string calldata orderId,
        string calldata fundId,
        bytes32 intentHash,
        OrderIntent calldata intent,
        uint256 createdAt
    ) external onlyOperator returns (bytes32 orderKey) {
        bytes32 fundKey = _checkIntentAgainstFund(fundId, intent);

        orderKey = keyOf(orderId);
        require(_orders[orderKey].orderKey == bytes32(0), "Order already registered");
        require(intentHash != bytes32(0), "Empty intentHash");
        require(orderKeyByIntentHash[intentHash] == bytes32(0), "Intent already used");
        require(keyOf(intent.orderId) == orderKey, "Intent orderId mismatch");
        _requireChain(intent.destinationChainId);

        Order storage o = _orders[orderKey];
        o.orderKey   = orderKey;
        o.orderId    = orderId;
        o.fundKey    = fundKey;
        o.intentHash = intentHash;
        o.progress   = OrderProgress.AWAITING_ORIGIN;
        o.createdAt  = createdAt;
        o.updatedAt  = createdAt;

        _intents[orderKey] = intent;
        _ordersByFund[fundKey].push(orderKey);
        orderKeyByIntentHash[intentHash] = orderKey;

        emit OrderRegistered(orderKey, fundKey, orderId, intentHash);
    }

    /// @notice Registers a transaction in MultiChainTxRegistry and appends it to the
    ///         list of the order. The role must be registered and active; it decides
    ///         whether intent.sourceChainId or intent.destinationChainId is used.
    /// @return txId  id of the transaction in MultiChainTxRegistry.
    /// @return index position of the transaction in the list of the order.
    function recordOrderTx(
        string calldata orderId,
        bytes32 role,
        OrderTxInput calldata input,
        TxInput calldata t,
        ExtraArg[] calldata extraArgs
    ) external onlyOperator returns (uint256 txId, uint256 index) {
        bytes32 orderKey = _orderKey(orderId);
        bytes32 chainId  = _roleChainId(orderKey, role);
        _requireDisposition(input.disposition);

        txId = txRegistry.registerTx(chainId, t, extraArgs);

        OrderTx[] storage list = _orderTxs[orderKey];
        index = list.length;

        OrderTx storage e = list.push();
        e.orderId     = _orders[orderKey].orderId;
        e.role        = role;
        e.chainId     = chainId;
        e.connectorId = input.connectorId;
        e.standard    = input.standard;
        e.disposition = input.disposition;
        e.txId        = txId;

        emit OrderTxLinked(orderKey, index, role, txId, msg.sender);
        emit OrderTxEvidenceUpdated(orderKey, index, input.disposition);
    }

    /// @notice Updates the evidence (disposition) of a transaction of the order.
    /// @param disposition a registered and active disposition, or bytes32(0) for none.
    function updateOrderTxEvidence(
        string calldata orderId,
        uint256 index,
        bytes32 disposition
    ) external onlyOperator {
        bytes32 orderKey = _orderKey(orderId);
        OrderTx storage e = _orderTx(orderKey, index);
        _requireDisposition(disposition);
        e.disposition = disposition;
        emit OrderTxEvidenceUpdated(orderKey, index, disposition);
    }

    /// @notice Updates the status of a transaction of the order in MultiChainTxRegistry.
    function updateOrderTxStatus(
        string calldata orderId,
        uint256 index,
        TxStatus status
    ) external onlyOperator {
        txRegistry.updateTxStatus(_orderTx(_orderKey(orderId), index).txId, status);
    }

    /// @notice Updates the projection of the order (progress, version).
    /// @dev updatedAt must be strictly greater than the stored updatedAt.
    ///      Only exception: while the order has no projection yet (version 0),
    ///      updatedAt may equal createdAt, because orders that were never updated
    ///      at the source (version 1) carry the same timestamp in both fields.
    function updateOrderProgress(
        string calldata orderId,
        OrderProgress progress,
        uint32 version,
        uint256 updatedAt
    ) external onlyOperator {
        Order storage o = _requireOrder(keyOf(orderId));
        require(version >= o.version, "Stale version");
        require(updatedAt >= o.createdAt, "updatedAt before createdAt");
        require(
            updatedAt > o.updatedAt || (o.version == 0 && updatedAt == o.createdAt),
            "updatedAt not after previous"
        );

        o.progress            = progress;
        o.version             = version;
        o.updatedAt           = updatedAt;

        emit OrderProgressUpdated(o.orderKey, progress, version);
    }

    // ============================================================
    // INTERNAL HELPERS
    // ============================================================

    /// @dev Reads the fund from FundRegistry (reverts with "Unknown fund" if it is not
    ///      registered) and checks that the intent is consistent with it.
    function _checkIntentAgainstFund(string calldata fundId, OrderIntent calldata intent)
        private
        view
        returns (bytes32 fundKey)
    {
        bytes32 chainId;
        address contractAddress;
        address stableAddress;
        (fundKey, chainId, contractAddress, stableAddress) = fundRegistry.getFundRef(fundId);

        require(intent.sourceChainId == chainId,         "Source chain != fund chain");
        require(intent.sourceAccount == contractAddress, "Source account != fund contract");
        require(intent.cashToken     == stableAddress,   "Cash token != fund stable");
    }

    function _requireOrder(bytes32 orderKey) private view returns (Order storage o) {
        o = _orders[orderKey];
        require(o.orderKey != bytes32(0), "Unknown order");
    }

    /// @dev Storage key of a registered order, from its orderId as text.
    function _orderKey(string calldata orderId) private view returns (bytes32) {
        return _requireOrder(keyOf(orderId)).orderKey;
    }

    function _orderTx(bytes32 orderKey, uint256 index) private view returns (OrderTx storage) {
        OrderTx[] storage list = _orderTxs[orderKey];
        require(index < list.length, "Unknown order tx");
        return list[index];
    }

    /// @dev Reverts if the disposition is unknown or deprecated. bytes32(0) is "none".
    function _requireDisposition(bytes32 disposition) private view {
        if (disposition == bytes32(0)) return;

        uint256 idx = _dispositionIndex[disposition];
        require(idx != 0, "Unknown disposition");
        require(_dispositions[idx - 1].active, "Disposition deprecated");
    }

    /// @dev Chain where a transaction of the given role happens.
    ///      Reverts if the role is unknown or deprecated.
    function _roleChainId(bytes32 orderKey, bytes32 role) private view returns (bytes32) {
        uint256 idx = _roleIndex[role];
        require(idx != 0, "Unknown role");

        OrderTxRole storage r = _roles[idx - 1];
        require(r.active, "Role deprecated");

        OrderIntent storage intent = _intents[orderKey];
        return r.onDestinationChain ? intent.destinationChainId : intent.sourceChainId;
    }

    // ============================================================
    // VIEW FUNCTIONS
    // ============================================================

    /// @notice All roles for order transactions, in registration order (deprecated ones included).
    function listOrderTxRoles() external view returns (OrderTxRole[] memory) {
        return _roles;
    }

    /// @notice All dispositions for order transactions, in registration order (deprecated ones included).
    function listOrderTxDispositions() external view returns (OrderTxDisposition[] memory) {
        return _dispositions;
    }

    function getOrder(string calldata orderId) external view returns (Order memory) {
        return _requireOrder(keyOf(orderId));
    }

    function getOrderIntent(string calldata orderId) external view returns (OrderIntent memory) {
        return _intents[_orderKey(orderId)];
    }

    /// @notice All transactions of the order, in the order they were recorded.
    function getOrderTxs(string calldata orderId) external view returns (OrderTx[] memory) {
        return _orderTxs[_orderKey(orderId)];
    }

    function getOrderTxCount(string calldata orderId) external view returns (uint256) {
        return _orderTxs[_orderKey(orderId)].length;
    }

    /// @notice One transaction of the order plus its full data stored in MultiChainTxRegistry.
    function getOrderTx(string calldata orderId, uint256 index)
        external
        view
        returns (OrderTx memory orderTx, BaseTx memory txData)
    {
        orderTx = _orderTx(_orderKey(orderId), index);
        txData  = txRegistry.getTx(orderTx.txId);
    }

    /// @notice orderIds of the fund, in registration order (empty if the fund has no orders).
    function getOrdersByFund(string calldata fundId) external view returns (string[] memory orderIds) {
        bytes32[] storage keys = _ordersByFund[keyOf(fundId)];
        orderIds = new string[](keys.length);
        for (uint256 i = 0; i < keys.length; i++) {
            orderIds[i] = _orders[keys[i]].orderId;
        }
    }

    /// @notice Sync state of many orders in one call, in the same order as orderIds.
    ///         An orderId that is not registered does not revert: its entry comes back
    ///         with registered == false.
    /// @dev Made for callers with a small budget of calls, as a Chainlink CRE workflow:
    ///      it replaces one getOrder and one getOrderTxs per order.
    function getOrderSyncStates(string[] calldata orderIds) external view returns (OrderSyncState[] memory states) {
        states = new OrderSyncState[](orderIds.length);
        for (uint256 i = 0; i < orderIds.length; i++) {
            bytes32 orderKey = keyOf(orderIds[i]);
            Order storage o = _orders[orderKey];
            if (o.orderKey == bytes32(0)) continue;

            OrderTx[] storage list = _orderTxs[orderKey];
            bytes32[] memory roles = new bytes32[](list.length);
            for (uint256 j = 0; j < list.length; j++) {
                roles[j] = list[j].role;
            }

            states[i] = OrderSyncState({
                registered: true,
                progress:   o.progress,
                version:    o.version,
                createdAt:  o.createdAt,
                updatedAt:  o.updatedAt,
                roles:      roles
            });
        }
    }

    /// @notice orderId registered with the given intentHash ("" if none).
    function getOrderIdByIntentHash(bytes32 intentHash) external view returns (string memory) {
        return _orders[orderKeyByIntentHash[intentHash]].orderId;
    }
}
