// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {CreReceiver} from "./CreReceiver.sol";
import {MultiChainTxRegistry} from "./MultiChainTxRegistry.sol";
import {FundRegistry} from "./FundRegistry.sol";
import {OrderRegistry} from "./OrderRegistry.sol";
import {TxStatus, TxInput, ExtraArg} from "./MultiChainTypes.sol";

/// @title MultiChainTxReceiver
/// @notice Entry point for Chainlink CRE workflows to write in the registries.
///         A workflow sends a report with the EVM Write capability; the
///         KeystoneForwarder verifies it and calls onReport here; this contract
///         decodes the report and performs its action: it registers a fund or an
///         order, updates the progress of an order, or registers a transaction, on
///         its own in MultiChainTxRegistry or linked to an order (OrderRegistry) or
///         to a fund (FundRegistry).
/// @dev    Roles this contract needs, one for each kind of action it is used for:
///         - RELAYER_ROLE in MultiChainTxRegistry, for REGISTER_TX and UPDATE_TX_STATUS;
///         - OPERATOR_ROLE in OrderRegistry, for RECORD_ORDER_TX, REGISTER_ORDER and
///           UPDATE_ORDER_PROGRESS;
///         - OPERATOR_ROLE in FundRegistry, for RECORD_FUND_CREATION_TX and REGISTER_FUND.
///
///         Report = abi.encode(Report), see the struct below. In a workflow (TypeScript):
///
///           encodeAbiParameters(
///             parseAbiParameters("(uint256 targetChainId, uint64 timestamp, uint8 action, bytes payload)"),
///             [{ targetChainId, timestamp, action, payload }])
///
///         where payload is, for each action:
///           REGISTER_TX              abi.encode(bytes32 chainId, TxInput t, ExtraArg[] extraArgs)
///           UPDATE_TX_STATUS         abi.encode(uint256 txId, TxStatus status)
///           RECORD_ORDER_TX          abi.encode(string orderId, bytes32 role,
///                                               OrderRegistry.OrderTxInput input,
///                                               TxInput t, ExtraArg[] extraArgs)
///           RECORD_FUND_CREATION_TX  abi.encode(string fundId, TxInput t, ExtraArg[] extraArgs)
///           REGISTER_FUND            abi.encode(FundRegistry.FundInput f, TxInput creationTx,
///                                               ExtraArg[] creationExtraArgs)
///           REGISTER_ORDER           abi.encode(string orderId, string fundId, bytes32 intentHash,
///                                               OrderRegistry.OrderIntent intent, uint256 createdAt)
///           UPDATE_ORDER_PROGRESS    abi.encode(string orderId, OrderRegistry.OrderProgress progress,
///                                               uint32 version, uint256 updatedAt)
///
///         A transaction registered with REGISTER_TX stays on its own: it cannot be
///         linked to an order or to a fund afterwards. To link it, register it with
///         RECORD_ORDER_TX or RECORD_FUND_CREATION_TX instead.
contract MultiChainTxReceiver is CreReceiver {

    // ============================================================
    // REPORT
    // ============================================================

    /// @dev New actions are added at the end: the numbers of the existing ones never change.
    enum Action {
        REGISTER_TX,              // 0  MultiChainTxRegistry.registerTx
        UPDATE_TX_STATUS,         // 1  MultiChainTxRegistry.updateTxStatus
        RECORD_ORDER_TX,          // 2  OrderRegistry.recordOrderTx
        RECORD_FUND_CREATION_TX,  // 3  FundRegistry.recordFundCreationTx
        REGISTER_FUND,            // 4  FundRegistry.registerFund
        REGISTER_ORDER,           // 5  OrderRegistry.registerOrder
        UPDATE_ORDER_PROGRESS     // 6  OrderRegistry.updateOrderProgress
    }

    /// @dev Envelope of every report. The first two fields exist to stop a signed
    ///      report from being replayed: the signatures of the DON do not commit to
    ///      a chain, and a report whose delivery reverted can be delivered again later.
    struct Report {
        uint256 targetChainId;  // EVM chain id of the chain of this contract (block.chainid)
        uint64  timestamp;      // DON time of the workflow execution, in seconds
        Action  action;
        bytes   payload;        // abi.encode of the arguments of the action
    }

    // ============================================================
    // STORAGE
    // ============================================================

    MultiChainTxRegistry public immutable txRegistry;

    /// @notice Registries where transactions are linked to orders and to funds.
    ///         Zero until the admin sets them: the action that needs one reverts meanwhile.
    OrderRegistry public orderRegistry;
    FundRegistry  public fundRegistry;

    /// @notice Value of maxFutureSkew when the contract is deployed.
    uint64 public constant DEFAULT_MAX_FUTURE_SKEW = 5 minutes;

    /// @notice How far in the future a report timestamp may be, in seconds, to absorb
    ///         the difference between the DON clock and the block timestamp.
    ///         Starts at DEFAULT_MAX_FUTURE_SKEW; the admin changes it with setMaxFutureSkew.
    uint64 public maxFutureSkew = DEFAULT_MAX_FUTURE_SKEW;

    /// @notice Timestamp of the last accepted status update of each transaction.
    ///         A status report must be newer than it, so an old report cannot
    ///         bring back a previous status.
    mapping(uint256 => uint64) public lastStatusUpdateAt;

    // ============================================================
    // ERRORS / EVENTS
    // ============================================================

    error WrongTargetChain(uint256 received, uint256 expected);
    error TimestampInFuture(uint64 timestamp, uint256 blockTimestamp);
    error StaleStatusUpdate(uint256 txId, uint64 timestamp, uint64 lastAccepted);
    error OrderRegistryNotSet();
    error FundRegistryNotSet();
    error RegistryMismatch(address target, address targetTxRegistry, address expectedTxRegistry);

    /// @param workflowId workflow that sent the report (zero when the forwarder
    ///        sends no metadata, as the simulation forwarder does).
    event TxRegisteredByWorkflow(uint256 indexed txId, bytes32 indexed chainId, bytes32 indexed workflowId, uint64 timestamp);
    event TxStatusUpdatedByWorkflow(uint256 indexed txId, TxStatus status, bytes32 indexed workflowId, uint64 timestamp);
    event OrderTxRecordedByWorkflow(uint256 indexed txId, string orderId, uint256 index, bytes32 indexed workflowId, uint64 timestamp);
    event FundCreationTxRecordedByWorkflow(uint256 indexed txId, string fundId, bytes32 indexed workflowId, uint64 timestamp);
    event FundRegisteredByWorkflow(bytes32 indexed fundKey, string fundId, bytes32 indexed workflowId, uint64 timestamp);
    event OrderRegisteredByWorkflow(bytes32 indexed orderKey, string orderId, bytes32 indexed workflowId, uint64 timestamp);
    event OrderProgressUpdatedByWorkflow(
        string orderId,
        OrderRegistry.OrderProgress progress,
        uint32 version,
        bytes32 indexed workflowId,
        uint64 timestamp
    );
    event MaxFutureSkewUpdated(uint64 previousSkew, uint64 newSkew);
    event OrderRegistryUpdated(address indexed previousRegistry, address indexed newRegistry);
    event FundRegistryUpdated(address indexed previousRegistry, address indexed newRegistry);

    /// @param forwarder Chainlink forwarder that delivers the reports.
    /// @param registry  MultiChainTxRegistry where the transactions are registered.
    constructor(address forwarder, MultiChainTxRegistry registry) CreReceiver(forwarder) {
        require(address(registry) != address(0), "Zero registry");
        txRegistry = registry;
    }

    // ============================================================
    // CONFIGURATION (admin)
    // ============================================================

    /// @notice Changes how far in the future a report timestamp may be, in seconds.
    /// @dev 0 accepts no timestamp ahead of the block. There is no upper limit, but a
    ///      large value weakens the protection: a report with a far-future timestamp
    ///      would block the later status updates of its transaction until that time.
    function setMaxFutureSkew(uint64 newSkew) external onlyAdmin {
        emit MaxFutureSkewUpdated(maxFutureSkew, newSkew);
        maxFutureSkew = newSkew;
    }

    /// @notice Sets the OrderRegistry used by the order actions (address(0) disables them).
    /// @dev It must use the same MultiChainTxRegistry as this contract. This contract
    ///      also needs OPERATOR_ROLE there, granted by an admin of that registry.
    function setOrderRegistry(OrderRegistry newRegistry) external onlyAdmin {
        if (address(newRegistry) != address(0)) _requireSameTxRegistry(address(newRegistry), address(newRegistry.txRegistry()));
        emit OrderRegistryUpdated(address(orderRegistry), address(newRegistry));
        orderRegistry = newRegistry;
    }

    /// @notice Sets the FundRegistry used by the fund actions (address(0) disables them).
    /// @dev It must use the same MultiChainTxRegistry as this contract. This contract
    ///      also needs OPERATOR_ROLE there, granted by an admin of that registry.
    function setFundRegistry(FundRegistry newRegistry) external onlyAdmin {
        if (address(newRegistry) != address(0)) _requireSameTxRegistry(address(newRegistry), address(newRegistry.txRegistry()));
        emit FundRegistryUpdated(address(fundRegistry), address(newRegistry));
        fundRegistry = newRegistry;
    }

    function _requireSameTxRegistry(address target, address targetTxRegistry) private view {
        if (targetTxRegistry != address(txRegistry)) revert RegistryMismatch(target, targetTxRegistry, address(txRegistry));
    }

    // ============================================================
    // REPORT PROCESSING
    // ============================================================

    function _processReport(bytes calldata metadata, bytes calldata report) internal override {
        Report memory r = abi.decode(report, (Report));

        // Cross-chain replay: a report made for another chain is not accepted here
        if (r.targetChainId != block.chainid) revert WrongTargetChain(r.targetChainId, block.chainid);

        // A timestamp ahead of the chain would block every later status update of a transaction
        if (r.timestamp > block.timestamp + maxFutureSkew) revert TimestampInFuture(r.timestamp, block.timestamp);

        (bytes32 workflowId,,) = _decodeMetadata(metadata);

        if (r.action == Action.REGISTER_TX) {
            _registerTx(r, workflowId);
        } else if (r.action == Action.UPDATE_TX_STATUS) {
            _updateTxStatus(r, workflowId);
        } else if (r.action == Action.RECORD_ORDER_TX) {
            _recordOrderTx(r, workflowId);
        } else if (r.action == Action.RECORD_FUND_CREATION_TX) {
            _recordFundCreationTx(r, workflowId);
        } else if (r.action == Action.REGISTER_FUND) {
            _registerFund(r, workflowId);
        } else if (r.action == Action.REGISTER_ORDER) {
            _registerOrder(r, workflowId);
        } else {
            _updateOrderProgress(r, workflowId);
        }
    }

    /// @dev A replayed report cannot register twice: MultiChainTxRegistry rejects a
    ///      transaction hash that is already registered on the same chain.
    function _registerTx(Report memory r, bytes32 workflowId) private {
        (bytes32 chainId, TxInput memory t, ExtraArg[] memory extraArgs) =
            abi.decode(r.payload, (bytes32, TxInput, ExtraArg[]));

        uint256 txId = txRegistry.registerTx(chainId, t, extraArgs);

        emit TxRegisteredByWorkflow(txId, chainId, workflowId, r.timestamp);
    }

    /// @dev Same-chain replay: a status report is only accepted when it is newer
    ///      than the last one accepted for the same transaction.
    function _updateTxStatus(Report memory r, bytes32 workflowId) private {
        (uint256 txId, TxStatus status) = abi.decode(r.payload, (uint256, TxStatus));

        uint64 last = lastStatusUpdateAt[txId];
        if (r.timestamp <= last) revert StaleStatusUpdate(txId, r.timestamp, last);
        lastStatusUpdateAt[txId] = r.timestamp;

        txRegistry.updateTxStatus(txId, status);

        emit TxStatusUpdatedByWorkflow(txId, status, workflowId, r.timestamp);
    }

    /// @dev Registers the transaction and appends it to the list of the order, in one
    ///      step. The chain is not in the payload: OrderRegistry takes it from the role
    ///      and from the intent of the order. A replayed report cannot record twice,
    ///      because MultiChainTxRegistry rejects a transaction hash already registered.
    function _recordOrderTx(Report memory r, bytes32 workflowId) private {
        if (address(orderRegistry) == address(0)) revert OrderRegistryNotSet();

        (
            string memory orderId,
            bytes32 role,
            OrderRegistry.OrderTxInput memory input,
            TxInput memory t,
            ExtraArg[] memory extraArgs
        ) = abi.decode(r.payload, (string, bytes32, OrderRegistry.OrderTxInput, TxInput, ExtraArg[]));

        (uint256 txId, uint256 index) = orderRegistry.recordOrderTx(orderId, role, input, t, extraArgs);

        emit OrderTxRecordedByWorkflow(txId, orderId, index, workflowId, r.timestamp);
    }

    /// @dev Registers the creation transaction of a fund and links it to the fund. A
    ///      replayed report cannot link twice: FundRegistry accepts one creation
    ///      transaction per fund.
    function _recordFundCreationTx(Report memory r, bytes32 workflowId) private {
        if (address(fundRegistry) == address(0)) revert FundRegistryNotSet();

        (string memory fundId, TxInput memory t, ExtraArg[] memory extraArgs) =
            abi.decode(r.payload, (string, TxInput, ExtraArg[]));

        uint256 txId = fundRegistry.recordFundCreationTx(fundId, t, extraArgs);

        emit FundCreationTxRecordedByWorkflow(txId, fundId, workflowId, r.timestamp);
    }

    /// @dev Registers a fund. Its stablecoin must already be registered in FundRegistry.
    ///      With a creation transaction hash in the payload, the creation transaction
    ///      is registered and linked too. A replayed report cannot register twice:
    ///      FundRegistry rejects a fundId that is already registered.
    function _registerFund(Report memory r, bytes32 workflowId) private {
        if (address(fundRegistry) == address(0)) revert FundRegistryNotSet();

        (FundRegistry.FundInput memory f, TxInput memory creationTx, ExtraArg[] memory creationExtraArgs) =
            abi.decode(r.payload, (FundRegistry.FundInput, TxInput, ExtraArg[]));

        bytes32 fundKey = fundRegistry.registerFund(f, creationTx, creationExtraArgs);

        emit FundRegisteredByWorkflow(fundKey, f.fundId, workflowId, r.timestamp);
    }

    /// @dev Registers an order of a fund that is already registered. A replayed report
    ///      cannot register twice: OrderRegistry rejects an orderId, and an intentHash,
    ///      that is already registered.
    function _registerOrder(Report memory r, bytes32 workflowId) private {
        if (address(orderRegistry) == address(0)) revert OrderRegistryNotSet();

        (
            string memory orderId,
            string memory fundId,
            bytes32 intentHash,
            OrderRegistry.OrderIntent memory intent,
            uint256 createdAt
        ) = abi.decode(r.payload, (string, string, bytes32, OrderRegistry.OrderIntent, uint256));

        bytes32 orderKey = orderRegistry.registerOrder(orderId, fundId, intentHash, intent, createdAt);

        emit OrderRegisteredByWorkflow(orderKey, orderId, workflowId, r.timestamp);
    }

    /// @dev Updates the progress of an order. A replayed or older report cannot bring
    ///      a previous progress back: OrderRegistry only accepts a version that is not
    ///      lower and an updatedAt that is strictly greater than the stored ones.
    function _updateOrderProgress(Report memory r, bytes32 workflowId) private {
        if (address(orderRegistry) == address(0)) revert OrderRegistryNotSet();

        (string memory orderId, OrderRegistry.OrderProgress progress, uint32 version, uint256 updatedAt) =
            abi.decode(r.payload, (string, OrderRegistry.OrderProgress, uint32, uint256));

        orderRegistry.updateOrderProgress(orderId, progress, version, updatedAt);

        emit OrderProgressUpdatedByWorkflow(orderId, progress, version, workflowId, r.timestamp);
    }
}
