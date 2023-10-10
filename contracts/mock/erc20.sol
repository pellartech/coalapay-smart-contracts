// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract TokenERC20 is ERC20 {
  constructor() ERC20("", "") {}

  function mint(address _account, uint256 _amount) public {
    _mint(_account, _amount);
  }
}
