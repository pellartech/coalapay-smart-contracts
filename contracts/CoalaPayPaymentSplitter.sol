// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

contract CoalaPayPaymentSplitter is AccessControl {
    event CompletePayment(string projectId, uint256 amount, address paymentToken);
    uint256 public feePercent = 500; //5%
    address public feeTo;

    constructor(
        address _feeTo
    ) {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        feeTo = _feeTo;
    }

    function setFee(uint256 _feePercent) external onlyRole(DEFAULT_ADMIN_ROLE) {
        feePercent = _feePercent;
    }

    function setFeeTo(address _feeTo) external onlyRole(DEFAULT_ADMIN_ROLE) {
        feeTo = _feeTo;
    }

    function completePayment(
        string calldata projectId,
        uint256 amount,
        address to,
        address paymentToken
    ) external payable {
        uint256 fee = getFee(amount);
        transferPayment(to, paymentToken, amount, fee);
        emit CompletePayment(projectId, amount, paymentToken);
    }

    function transferPayment(address to, address paymentToken, uint256 amount, uint256 fee) internal {
        if (paymentToken == address(0)) {
            require(amount + fee == msg.value, "Incorrect token price");
            (bool fullAmountSuccess, ) = to.call{ value: amount }("");
            require(fullAmountSuccess, "Transfer full amount failed");
            (bool feeAmountSuccess, ) = feeTo.call{ value: fee }("");
            require(feeAmountSuccess, "Transfer fee amount failed");
        } else {
            SafeERC20.safeTransferFrom(IERC20(paymentToken), msg.sender, to, amount);
            SafeERC20.safeTransferFrom(IERC20(paymentToken), msg.sender, feeTo, fee);
        }
    }

    function getFee(uint256 _fullAmount) public view returns (uint256 fee) {
        fee = (_fullAmount * feePercent) / 10000;
    }
}