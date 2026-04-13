// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title  MockX
/// @notice Volatility token agents trade against bUSD inside Atlas. Open-mint for
///         demo / testnet only — never deploy this to mainnet.
contract MockX is ERC20 {
    constructor() ERC20("Mock X", "MOCKX") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
