// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/AccessControl.sol";

// Minimal interface for ERC20 token interactions.
interface IERC20 {
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
}

contract CoalaPayCashPayments is AccessControl {
    bytes32 public constant FUNDER_ROLE = keccak256("FUNDER_ROLE");

    // The address from which tokens will be transferred.
    address public holdingAccount;

    // The address to which funds will be transferred.
    address public fundingAccount;

    // Mapping to track whitelisted user IDs.
    mapping(string => bool) public whitelistedUsers;

    // Structure representing a payment cycle.
    struct PaymentCycle {
        uint256 startTimestamp;     // Start time for the payment cycle.
        uint256 endTimestamp;       // End time for the payment cycle.
        address paymentToken;       // Address of the ERC20 token used for payments.
        uint256 disbursementAmount; // Amount to be transferred per valid redemption.
    }

    // Mapping of cycleId to PaymentCycle details.
    mapping(uint256 => PaymentCycle) public paymentCycles;

    // Record to track if a user has redeemed in a given payment cycle: userId => cycleId => redeemed.
    mapping(string => mapping(uint256 => bool)) public hasRedeemed;

    // Events for logging significant contract actions.
    event UserWhitelisted(string userId);
    event UserRemovedFromWhitelist(string userId);
    event PaymentCycleSet(
        uint256 cycleId,
        uint256 startTimestamp,
        uint256 endTimestamp,
        address paymentToken,
        uint256 disbursementAmount
    );
    event FundingDisbursed(
        string userId,
        uint256 cycleId,
        address vendor,
        uint256 amount
    );
    event HoldingAccountChanged(address oldAccount, address newAccount);
    event FundingAccountChanged(address oldAccount, address newAccount);

    constructor(address _holdingAccount, address _fundingAccount) {
        require(_holdingAccount != address(0), "Invalid holding account");
        holdingAccount = _holdingAccount;

        require(_fundingAccount != address(0), "Invalid funding account");
        fundingAccount = _fundingAccount;

        // Grant the deployer the default admin role
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(FUNDER_ROLE, msg.sender);
    }

    /// @notice Admin function to update the holding account from which tokens will be transferred.
    /// @param newHoldingAccount The address of the new holding account.
    function setHoldingAccount(address newHoldingAccount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newHoldingAccount != address(0), "Invalid holding account");
        address old = holdingAccount;
        holdingAccount = newHoldingAccount;
        emit HoldingAccountChanged(old, newHoldingAccount);
    }

    /// @notice Admin function to update the funding account to which funds will be transferred.
    /// @param newFundingAccount The address of the new funding account.
    function setFundingAccount(address newFundingAccount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newFundingAccount != address(0), "Invalid funding account");
        address old = fundingAccount;
        fundingAccount = newFundingAccount;
        emit FundingAccountChanged(old, newFundingAccount);
    }

    /// @notice Admin function to whitelist a user.
    /// @param userId The unique identifier for the user.
    function whitelistUser(string memory userId) external onlyRole(DEFAULT_ADMIN_ROLE) {
        whitelistedUsers[userId] = true;
        emit UserWhitelisted(userId);
    }

    /// @notice Admin function to remove a user from the whitelist.
    /// @param userId The unique identifier for the user.
    function removeWhitelistUser(string memory userId) external onlyRole(DEFAULT_ADMIN_ROLE) {
        whitelistedUsers[userId] = false;
        emit UserRemovedFromWhitelist(userId);
    }

    /// @notice Admin function to bulk whitelist users.
    /// @param userIds Array of user IDs to whitelist.
    function bulkWhitelistUsers(string[] memory userIds) external onlyRole(DEFAULT_ADMIN_ROLE) {
        for (uint256 i = 0; i < userIds.length; i++) {
            whitelistedUsers[userIds[i]] = true;
            emit UserWhitelisted(userIds[i]);
        }
    }

    /// @notice Admin function to bulk remove users from the whitelist.
    /// @param userIds Array of user IDs to remove from the whitelist.
    function bulkRemoveWhitelistUsers(string[] memory userIds) external onlyRole(DEFAULT_ADMIN_ROLE) {
        for (uint256 i = 0; i < userIds.length; i++) {
            whitelistedUsers[userIds[i]] = false;
            emit UserRemovedFromWhitelist(userIds[i]);
        }
    }

    /// @notice Admin function to set or update a payment cycle.
    /// @param cycleId The unique identifier for the payment cycle.
    /// @param startTimestamp The UNIX timestamp marking the start of the cycle.
    /// @param endTimestamp The UNIX timestamp marking the end of the cycle.
    /// @param paymentToken The address of the ERC20 token used for disbursement.
    /// @param disbursementAmount The amount of tokens to be transferred on redemption.
    function setPaymentCycle(
        uint256 cycleId,
        uint256 startTimestamp,
        uint256 endTimestamp,
        address paymentToken,
        uint256 disbursementAmount
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(startTimestamp < endTimestamp, "Invalid time window");
        paymentCycles[cycleId] = PaymentCycle(startTimestamp, endTimestamp, paymentToken, disbursementAmount);

        emit PaymentCycleSet(cycleId, startTimestamp, endTimestamp, paymentToken, disbursementAmount);
    }

    /// @notice Admin function to grant FUNDER_ROLE to an account.
    /// @param account The address to grant the role.
    function grantFunderRole(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        grantRole(FUNDER_ROLE, account);
    }

    /// @notice Admin function to revoke FUNDER_ROLE from an account.
    /// @param account The address to revoke the role.
    function revokeFunderRole(address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        revokeRole(FUNDER_ROLE, account);
    }

    /// @notice Vendor calls this function to request funding after scanning a user's QR code.
    /// @param userId The unique user ID from the QR code.
    /// @param cycleId The payment cycle identifier.
    function requestFunding(
        string memory userId,
        uint256 cycleId
    ) external onlyRole(FUNDER_ROLE) {
        // Check that the user is whitelisted.
        require(whitelistedUsers[userId], "User not whitelisted");

        // Retrieve payment cycle details and verify that the current time is within the cycle window.
        PaymentCycle memory cycle = paymentCycles[cycleId];
        require(cycle.startTimestamp != 0 && cycle.endTimestamp != 0, "Cycle not set");
        require(
            block.timestamp >= cycle.startTimestamp && block.timestamp <= cycle.endTimestamp,
            "Cycle not active"
        );

        // Ensure that the user has not already redeemed in this cycle.
        require(!hasRedeemed[userId][cycleId], "Already redeemed in this cycle");

        // Mark the user as redeemed for this cycle.
        hasRedeemed[userId][cycleId] = true;

        // Transfer the funds from the holding account to the caller (vendor).
        // Make sure the contract is approved to spend at least 'disbursementAmount' of `holdingAccount`'s tokens.
        IERC20(cycle.paymentToken).transferFrom(
            holdingAccount,
            fundingAccount,
            cycle.disbursementAmount
        );

        emit FundingDisbursed(userId, cycleId, msg.sender, cycle.disbursementAmount);
    }

        /// @notice Vendors can call this function to request funding for multiple users in a given cycle.
    /// @param userIds The list of user IDs to redeem.
    /// @param cycleId The payment cycle ID.
    function bulkRequestFunding(
        string[] memory userIds,
        uint256 cycleId
    ) external onlyRole(FUNDER_ROLE) {
        PaymentCycle memory cycle = paymentCycles[cycleId];

        require(cycle.startTimestamp != 0 && cycle.endTimestamp != 0, "Cycle not set");
        require(
            block.timestamp >= cycle.startTimestamp && block.timestamp <= cycle.endTimestamp,
            "Cycle not active"
        );

        uint256 successfulDisbursements = 0;

        for (uint256 i = 0; i < userIds.length; i++) {
            string memory userId = userIds[i];

            if (
                whitelistedUsers[userId] &&
                !hasRedeemed[userId][cycleId]
            ) {
                hasRedeemed[userId][cycleId] = true;

                emit FundingDisbursed(userId, cycleId, msg.sender, cycle.disbursementAmount);
                successfulDisbursements++;
            }
        }

        if (successfulDisbursements > 0) {
            uint256 totalAmount = cycle.disbursementAmount * successfulDisbursements;

            require(
                IERC20(cycle.paymentToken).transferFrom(
                    holdingAccount,
                    fundingAccount,
                    totalAmount
                ),
                "Transfer failed"
            );
        }
    }

}
