// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { StrategyBase } from "./StrategyBase.sol";
import { SubWallet } from "./SubWallet.sol";

interface IDemoAMM {
    function swap(address tokenIn, uint256 amountIn, uint256 minOut, address to) external returns (uint256);
    function reserveA() external view returns (uint256);
    function reserveB() external view returns (uint256);
    function getAmountOut(uint256, uint256, uint256) external pure returns (uint256);
    function spotPriceBInA() external view returns (uint256);
}

/// @title  TradingStrategy
/// @author Atlas
/// @notice Concrete strategy that trades `asset` (bUSD) against a volatile
///         `other` token (MOCKX) on a DemoAMM-compatible pool. The actual
///         decision logic (when to buy/sell) is carried by the executor's
///         `submitAction` payload, which this contract validates but does
///         not invent.
/// @dev    Action payload schema (abi-encoded):
///           (bool isBuy, uint256 amountIn, uint256 minOut, uint256 deadline)
///         Strategy refuses actions past deadline, or that exceed the
///         sub-wallet's current balance. `totalAssets()` values the volatile
///         position at current AMM spot — manipulable across a single call
///         by a malicious AMM but that's out of scope here (X Layer's real
///         Uniswap deployment fixes this in production).
contract TradingStrategy is StrategyBase {
    error InvalidAction();
    error DeadlineExpired();
    error InsufficientBalance();

    IERC20 public immutable other;     // MOCKX
    IDemoAMM public immutable amm;

    constructor(
        address _vault,
        address _asset,
        address _other,
        address _amm,
        string memory _name
    ) StrategyBase(_vault, _asset, _name) {
        other = IERC20(_other);
        amm = IDemoAMM(_amm);
    }

    /// @notice Total assets valued at current AMM spot (bUSD-equivalent).
    function totalAssets() public view override returns (uint256) {
        uint256 a = asset.balanceOf(subWallet);
        uint256 b = other.balanceOf(subWallet);
        if (b == 0) return a;
        uint256 spot = amm.spotPriceBInA();       // asset per other, 1e18 scaled
        return a + (b * spot) / 1e18;
    }

    /// @dev Executor submits (isBuy, amountIn, minOut, deadline).
    function _trade(bytes calldata actionData) internal override {
        (bool isBuy, uint256 amountIn, uint256 minOut, uint256 deadline) = abi.decode(
            actionData,
            (bool, uint256, uint256, uint256)
        );
        if (block.timestamp > deadline) revert DeadlineExpired();
        if (amountIn == 0) revert InvalidAction();

        address tokenIn = isBuy ? address(asset) : address(other);
        uint256 bal = IERC20(tokenIn).balanceOf(subWallet);
        if (bal < amountIn) revert InsufficientBalance();

        // 1) approve AMM from sub-wallet
        SubWallet(payable(subWallet)).execute(
            tokenIn,
            0,
            abi.encodeWithSelector(IERC20.approve.selector, address(amm), amountIn)
        );
        // 2) swap (destination = subWallet, so AMM delivers output into our custody)
        SubWallet(payable(subWallet)).execute(
            address(amm),
            0,
            abi.encodeWithSelector(amm.swap.selector, tokenIn, amountIn, minOut, subWallet)
        );
    }

    /// @dev Converts volatile positions to `asset` to satisfy a vault recall.
    function _liquidateForVault(uint256 amount) internal override returns (uint256) {
        uint256 curr = asset.balanceOf(subWallet);
        if (curr >= amount) return amount;
        uint256 need = amount - curr;
        uint256 otherBal = other.balanceOf(subWallet);
        if (otherBal == 0) return curr;

        // Sell enough `other` to cover the shortfall (with a slippage cushion).
        uint256 rA = amm.reserveA();
        uint256 rB = amm.reserveB();
        // approximate amount of `other` we need to sell given current spot
        uint256 toSell = need * 1e18 / amm.spotPriceBInA();
        if (toSell > otherBal) toSell = otherBal;

        // quote + slippage guard (5%)
        uint256 quotedOut = amm.getAmountOut(toSell, rB, rA);
        uint256 minOut = (quotedOut * 9500) / 10_000;

        SubWallet(payable(subWallet)).execute(
            address(other),
            0,
            abi.encodeWithSelector(IERC20.approve.selector, address(amm), toSell)
        );
        SubWallet(payable(subWallet)).execute(
            address(amm),
            0,
            abi.encodeWithSelector(amm.swap.selector, address(other), toSell, minOut, subWallet)
        );

        uint256 newAsset = asset.balanceOf(subWallet);
        return newAsset >= amount ? amount : newAsset;
    }
}
