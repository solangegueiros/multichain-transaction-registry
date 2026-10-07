// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title AdminProtected
/// @notice OpenZeppelin AccessControl with an admin that can never be left empty.
///         Shared by MultiChainTxRegistry, FundRegistry and OrderRegistry.
/// @dev    The deployer receives DEFAULT_ADMIN_ROLE, which manages every role with
///         grantRole / revokeRole. There may be several admins.
///
///         An admin cannot give up the role by itself: renounceRole is disabled for
///         DEFAULT_ADMIN_ROLE and an admin cannot revoke its own admin role. An admin
///         can only be removed by another admin, so at least one always remains.
///
///         To hand the contract over: the current admin grants DEFAULT_ADMIN_ROLE to
///         the new one, and the new admin revokes it from the old one.
///
///         Unauthorized calls revert with AccessControlUnauthorizedAccount(account, role).
abstract contract AdminProtected is AccessControl {

    modifier onlyAdmin() {
        _checkRole(DEFAULT_ADMIN_ROLE);
        _;
    }

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    /// @notice Gives up a role held by the caller. Disabled for DEFAULT_ADMIN_ROLE.
    function renounceRole(bytes32 role, address callerConfirmation) public virtual override {
        require(role != DEFAULT_ADMIN_ROLE, "Admin cannot renounce");
        super.renounceRole(role, callerConfirmation);
    }

    /// @notice Revokes a role. An admin cannot revoke its own DEFAULT_ADMIN_ROLE:
    ///         without this, revoking itself would be a way around renounceRole.
    function revokeRole(bytes32 role, address account) public virtual override {
        require(role != DEFAULT_ADMIN_ROLE || account != msg.sender, "Admin cannot revoke itself");
        super.revokeRole(role, account);
    }
}
