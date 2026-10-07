// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {AdminProtected} from "./AdminProtected.sol";
import {MultiChainTxRegistry} from "./MultiChainTxRegistry.sol";

/// @title RegistryBase
/// @notice What FundRegistry and OrderRegistry have in common: the link to
///         MultiChainTxRegistry, the admin / operator access control and the
///         derivation of storage keys from text ids.
/// @dev    A contract that inherits this must be a relayer in MultiChainTxRegistry
///         (txRegistry.grantRole(RELAYER_ROLE, address(this))).
abstract contract RegistryBase is AdminProtected {

    // ============================================================
    // STORAGE
    // ============================================================

    MultiChainTxRegistry public immutable txRegistry;

    // ============================================================
    // ACCESS CONTROL
    // ============================================================

    /// @dev Roles come from OpenZeppelin AccessControl, through AdminProtected:
    ///      - DEFAULT_ADMIN_ROLE (the deployer): manages the operators with
    ///        grantRole / revokeRole(OPERATOR_ROLE, account).
    ///      - OPERATOR_ROLE: loads and updates the data of the registry.
    ///      Unauthorized calls revert with AccessControlUnauthorizedAccount(account, role).
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    modifier onlyOperator() {
        _checkRole(OPERATOR_ROLE);
        _;
    }

    constructor(MultiChainTxRegistry registry) {
        require(address(registry) != address(0), "Zero registry");
        txRegistry = registry;
    }

    // ============================================================
    // KEYS
    // ============================================================

    /// @notice keccak256 of the normalized id (lowercase, no whitespace).
    /// @dev Funds and orders are identified by fundId / orderId: the functions take
    ///      the id as text and derive the storage key (fundKey / orderKey) with this function.
    function keyOf(string memory id) public pure returns (bytes32) {
        bytes memory b   = bytes(id);
        bytes memory out = new bytes(b.length);
        uint256 n = 0;
        for (uint256 i = 0; i < b.length; i++) {
            bytes1 c = b[i];
            if (c == 0x20 || c == 0x09 || c == 0x0A || c == 0x0D) continue;
            if (c >= 0x41 && c <= 0x5A) c = bytes1(uint8(c) + 32);
            out[n++] = c;
        }
        require(n != 0, "Empty id");
        assembly { mstore(out, n) }
        return keccak256(out);
    }

    // ============================================================
    // INTERNAL HELPERS
    // ============================================================

    function _requireChain(bytes32 chainId) internal view {
        (bytes32 stored,,,,,) = txRegistry.chains(chainId);
        require(stored != bytes32(0), "Chain not registered");
    }
}
