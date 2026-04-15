// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { StrategyBase } from "./StrategyBase.sol";
import { SubWallet } from "./SubWallet.sol";

interface ITwapOracle {
    function twap30m() external view returns (uint256);
}

/// @title  AggregatorStrategy
/// @author Atlas
/// @notice Strategy that executes swap calldata prepared off-chain by the
///         OKX DEX Aggregator (Onchain OS DEX skill). The executor fetches a
///         quote from OKX, receives `(routerAddress, callData)`, and submits
///         `(callData)` to this strategy. The strategy forwards the call to a
///         single whitelisted router address through its sub-wallet.
/// @dev    Action payload schema (abi-encoded):
///           (address tokenIn, uint256 amountIn, uint256 minOut, bytes callData, uint256 deadline)
///         `tokenIn` identifies which ERC-20 approval to grant the router.
///         `minOut` is a post-trade sanity guard on the received balance of
///         the "other" token (or `asset`, for sells).
contract AggregatorStrategy is StrategyBase {
    error InvalidAction();
    error DeadlineExpired();
    error InsufficientBalance();
    error RouterCallFailed();
    error SlippageExceeded();

    IERC20 public immutable other;          // volatile token (e.g. OKB, ETH)
    address public immutable router;        // whitelisted OKX aggregator router
    ITwapOracle public immutable oracle;    // 30-min TWAP for NAV

    constructor(
        address _vault,
        address _asset,
        address _other,
        address _router,
        address _oracle,
        string memory _name
    ) StrategyBase(_vault, _asset, _name) {
        other = IERC20(_other);
        router = _router;
        oracle = ITwapOracle(_oracle);
    }

    /// @notice Total assets valued at TWAP from a Uniswap v3 pool (or any
    ///         oracle implementing `twap30m()`).
    function totalAssets() public view override returns (uint256) {
        uint256 a = asset.balanceOf(subWallet);
        uint256 b = other.balanceOf(subWallet);
        if (b == 0) return a;
        uint256 price = oracle.twap30m();
        return a + (b * price) / 1e18;
    }

    /// @dev Executor submits (tokenIn, amountIn, minOut, callData, deadline).
    ///      callData is the ABI-encoded call prepared by OKX's DEX aggregator.
    function _trade(bytes calldata actionData) internal override {
        (
            address tokenIn,
            uint256 amountIn,
            uint256 minOut,
            bytes memory callData,
            uint256 deadline
        ) = abi.decode(actionData, (address, uint256, uint256, bytes, uint256));

        if (block.timestamp > deadline) revert DeadlineExpired();
        if (amountIn == 0) revert InvalidAction();
        if (tokenIn != address(asset) && tokenIn != address(other)) revert InvalidAction();

        uint256 balIn = IERC20(tokenIn).balanceOf(subWallet);
        if (balIn < amountIn) revert InsufficientBalance();

        address tokenOut = tokenIn == address(asset) ? address(other) : address(asset);
        uint256 outBefore = IERC20(tokenOut).balanceOf(subWallet);

        // 1) approve router from sub-wallet (exact amount — not infinite)
        SubWallet(payable(subWallet)).execute(
            tokenIn,
            0,
            abi.encodeWithSelector(IERC20.approve.selector, router, amountIn)
        );
        // 2) execute aggregator calldata via sub-wallet, to the router
        SubWallet(payable(subWallet)).execute(router, 0, callData);
        // 3) revoke residual approval
        SubWallet(payable(subWallet)).execute(
            tokenIn,
            0,
            abi.encodeWithSelector(IERC20.approve.selector, router, 0)
        );

        uint256 received = IERC20(tokenOut).balanceOf(subWallet) - outBefore;
        if (received < minOut) revert SlippageExceeded();
    }

    /// @dev Converts volatile positions back to `asset` by selling through the
    ///      same aggregator. The executor must submit a SELL action before
    ///      `returnToVault` if idle balance is insufficient — we don't do
    ///      auto-liquidation here because OKX aggregator needs off-chain
    ///      quoting. Returns whatever asset balance is currently idle.
    function _liquidateForVault(uint256 /* amount */) internal pure override returns (uint256) {
        return 0;
    }
}
