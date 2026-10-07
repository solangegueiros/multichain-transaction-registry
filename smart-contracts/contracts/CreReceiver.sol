// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {AdminProtected} from "./AdminProtected.sol";
import {IReceiver} from "./interfaces/IReceiver.sol";

/// @title CreReceiver
/// @notice Base of the contracts that receive Chainlink CRE reports: checks who
///         delivers the report and which workflow produced it, then hands the
///         payload to the concrete contract.
/// @dev    Adapted from the ReceiverTemplate of the Chainlink CRE documentation
///         (Building Consumer Contracts). Same checks, with these differences:
///         - permissions are managed by DEFAULT_ADMIN_ROLE (AdminProtected) instead
///           of the Ownable owner, like the other contracts of this project;
///         - the forwarder can never be set to address(0), so the sender check
///           cannot be switched off;
///         - _processReport also receives the metadata, so the concrete contract
///           can record which workflow sent the report.
///
///         Trust boundary: the KeystoneForwarder verifies the signatures of the DON
///         before calling onReport. Accepting calls only from the forwarder is what
///         makes a report trustworthy. The workflow checks are an extra layer:
///         without them, ANY workflow of ANY owner can deliver reports here.
abstract contract CreReceiver is IReceiver, AdminProtected {

    // ============================================================
    // STORAGE
    // ============================================================

    /// @dev Only this address can call onReport. Never zero.
    address private _forwarder;

    /// @dev Optional checks, all disabled while zero.
    address private _expectedAuthor;        // owner of the workflow
    bytes10 private _expectedWorkflowName;  // only checked together with the author
    bytes32 private _expectedWorkflowId;    // one specific workflow

    bytes private constant HEX_CHARS = "0123456789abcdef";

    // ============================================================
    // ERRORS / EVENTS
    // ============================================================

    error InvalidForwarderAddress();
    error InvalidSender(address sender, address expected);
    error InvalidAuthor(address received, address expected);
    error InvalidWorkflowName(bytes10 received, bytes10 expected);
    error InvalidWorkflowId(bytes32 received, bytes32 expected);
    error WorkflowNameRequiresAuthorValidation();

    event ForwarderAddressUpdated(address indexed previousForwarder, address indexed newForwarder);
    event ExpectedAuthorUpdated(address indexed previousAuthor, address indexed newAuthor);
    event ExpectedWorkflowNameUpdated(bytes10 indexed previousName, bytes10 indexed newName);
    event ExpectedWorkflowIdUpdated(bytes32 indexed previousId, bytes32 indexed newId);

    // ============================================================
    // Chain name: ethereum-testnet-sepolia
    // Ethereum Sepolia Mock Forwarder Address: 0x15fC6ae953E024d975e77382eEeC56A9101f9F88
    // Ethereum Sepolia Forwarder Address: 0xF8344CFd5c43616a4366C34E3EEE75af79a74482 

    /// @param forwarder Chainlink forwarder that delivers the reports: the
    ///        KeystoneForwarder of the network for deployed workflows, or the
    ///        MockKeystoneForwarder for `cre workflow simulate --broadcast`.
    constructor(address forwarder) {
        _setForwarder(forwarder);
    }

    // ============================================================
    // REPORT ENTRY POINT
    // ============================================================

    /// @inheritdoc IReceiver
    function onReport(bytes calldata metadata, bytes calldata report) external override {
        // 1. Only the forwarder, which has already verified the DON signatures
        if (msg.sender != _forwarder) revert InvalidSender(msg.sender, _forwarder);

        // 2. Workflow identity, when any of the optional checks is configured
        if (_expectedWorkflowId != bytes32(0) || _expectedAuthor != address(0) || _expectedWorkflowName != bytes10(0)) {
            (bytes32 workflowId, bytes10 workflowName, address workflowOwner) = _decodeMetadata(metadata);

            if (_expectedWorkflowId != bytes32(0) && workflowId != _expectedWorkflowId) {
                revert InvalidWorkflowId(workflowId, _expectedWorkflowId);
            }
            if (_expectedAuthor != address(0) && workflowOwner != _expectedAuthor) {
                revert InvalidAuthor(workflowOwner, _expectedAuthor);
            }

            // A workflow name is unique per owner only, and is truncated to 40 bits:
            // alone it can be collided, so it is only accepted together with the author.
            if (_expectedWorkflowName != bytes10(0)) {
                if (_expectedAuthor == address(0)) revert WorkflowNameRequiresAuthorValidation();
                if (workflowName != _expectedWorkflowName) {
                    revert InvalidWorkflowName(workflowName, _expectedWorkflowName);
                }
            }
        }

        _processReport(metadata, report);
    }

    /// @dev Business logic of the concrete contract. Called only after the sender
    ///      and the workflow identity were accepted.
    /// @param metadata as received by onReport (see _decodeMetadata).
    /// @param report   ABI-encoded payload produced by the workflow.
    function _processReport(bytes calldata metadata, bytes calldata report) internal virtual;

    // ============================================================
    // CONFIGURATION (admin)
    // ============================================================

    /// @notice Changes the forwarder, e.g. from the simulation forwarder to the
    ///         KeystoneForwarder when going to production.
    function setForwarderAddress(address forwarder) external onlyAdmin {
        _setForwarder(forwarder);
    }

    /// @notice Accepts only reports of workflows owned by this address (address(0) disables).
    function setExpectedAuthor(address author) external onlyAdmin {
        emit ExpectedAuthorUpdated(_expectedAuthor, author);
        _expectedAuthor = author;
    }

    /// @notice Accepts only reports of the workflow with this name ("" disables).
    ///         Requires setExpectedAuthor: without it, onReport reverts.
    /// @dev The name is stored as the forwarder sends it: the first 10 hex characters
    ///      of sha256(name), taken as ASCII bytes.
    function setExpectedWorkflowName(string calldata name) external onlyAdmin {
        bytes10 encoded = bytes10(0);

        if (bytes(name).length != 0) {
            bytes32 hash = sha256(bytes(name));
            bytes memory first10 = new bytes(10);
            for (uint256 i = 0; i < 5; i++) {
                first10[i * 2]     = HEX_CHARS[uint8(hash[i] >> 4)];
                first10[i * 2 + 1] = HEX_CHARS[uint8(hash[i] & 0x0f)];
            }
            encoded = bytes10(first10);
        }

        emit ExpectedWorkflowNameUpdated(_expectedWorkflowName, encoded);
        _expectedWorkflowName = encoded;
    }

    /// @notice Accepts only reports of this workflow (bytes32(0) disables).
    ///         The strictest check, for when a single workflow writes here.
    function setExpectedWorkflowId(bytes32 workflowId) external onlyAdmin {
        emit ExpectedWorkflowIdUpdated(_expectedWorkflowId, workflowId);
        _expectedWorkflowId = workflowId;
    }

    function _setForwarder(address forwarder) private {
        if (forwarder == address(0)) revert InvalidForwarderAddress();
        emit ForwarderAddressUpdated(_forwarder, forwarder);
        _forwarder = forwarder;
    }

    // ============================================================
    // VIEW FUNCTIONS
    // ============================================================

    function getForwarderAddress() external view returns (address) {
        return _forwarder;
    }

    function getExpectedAuthor() external view returns (address) {
        return _expectedAuthor;
    }

    function getExpectedWorkflowName() external view returns (bytes10) {
        return _expectedWorkflowName;
    }

    function getExpectedWorkflowId() external view returns (bytes32) {
        return _expectedWorkflowId;
    }

    /// @notice Declares IReceiver, which the forwarder checks before delivering,
    ///         besides the interfaces of AccessControl.
    function supportsInterface(bytes4 interfaceId) public view virtual override(AccessControl, IERC165) returns (bool) {
        return interfaceId == type(IReceiver).interfaceId || super.supportsInterface(interfaceId);
    }

    // ============================================================
    // INTERNAL HELPERS
    // ============================================================

    /// @dev Reads the workflow identity from the metadata, which is
    ///      abi.encodePacked(bytes32 workflowId, bytes10 workflowName, address workflowOwner)
    ///      followed by a bytes2 reportId (64 bytes from the KeystoneForwarder).
    ///      Shorter metadata, as sent by the simulation forwarder, reads as zeros.
    function _decodeMetadata(bytes calldata metadata)
        internal
        pure
        returns (bytes32 workflowId, bytes10 workflowName, address workflowOwner)
    {
        if (metadata.length < 62) return (bytes32(0), bytes10(0), address(0));

        workflowId    = bytes32(metadata[0:32]);
        workflowName  = bytes10(metadata[32:42]);
        workflowOwner = address(bytes20(metadata[42:62]));
    }
}
