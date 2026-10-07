// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/// @title IReceiver - receives Chainlink CRE (Keystone) reports
/// @notice Interface the KeystoneForwarder calls to deliver a workflow report.
///         Implementations must also declare support for it through ERC165, because
///         the forwarder checks supportsInterface before delivering.
/// @dev Same interface as the one published in the Chainlink CRE documentation
///      (Building Consumer Contracts), with the compiler version pinned.
interface IReceiver is IERC165 {
    /// @notice Handles an incoming report.
    /// @dev If this call reverts, the same signed report can be delivered again later.
    ///      The receiver is responsible for discarding stale or replayed reports.
    /// @param metadata Workflow identity: abi.encodePacked(bytes32 workflowId,
    ///                 bytes10 workflowName, address workflowOwner), followed by a
    ///                 bytes2 reportId. 64 bytes when delivered by the KeystoneForwarder.
    /// @param report   ABI-encoded payload produced by the workflow.
    function onReport(bytes calldata metadata, bytes calldata report) external;
}
