// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title  DemoAMM
/// @author Atlas
/// @notice Single-pool constant-product AMM (x * y = k) used by the Atlas agent
///         tournament for on-chain swaps. Mirrors Uniswap v2 math at the surface
///         (`getAmountOut` is identical with a 0.3% fee) so the strategies are
///         portable to a real Uniswap deployment with a one-line swap.
/// @dev    Single bUSD/MOCK-X pool — no factory, no router, no LP tokens. Only
///         `addLiquidity` (used by the deployer once) and `swap`. Removing
///         liquidity is intentionally absent for the demo.
contract DemoAMM is ReentrancyGuard {
    using SafeERC20 for IERC20;

    string public constant VERSION = "0.1.0";
    uint256 public constant FEE_NUM = 997;
    uint256 public constant FEE_DEN = 1000;

    error UnknownToken();
    error InsufficientLiquidity();
    error InsufficientOutput();
    error ZeroAmount();

    event LiquidityAdded(address indexed by, uint256 amountA, uint256 amountB);
    event Swap(
        address indexed sender,
        address indexed tokenIn,
        uint256 amountIn,
        address indexed tokenOut,
        uint256 amountOut,
        address to
    );

    IERC20 public immutable tokenA;
    IERC20 public immutable tokenB;

    /// @notice Reserves cached after each operation for cheap reads.
    uint256 public reserveA;
    uint256 public reserveB;

    constructor(IERC20 _tokenA, IERC20 _tokenB) {
        tokenA = _tokenA;
        tokenB = _tokenB;
    }

    /// @notice Adds liquidity. Permissionless (testnet demo) — anyone can top up
    ///         either side, but ratios should match the spot or arb will eat them.
    function addLiquidity(uint256 amountA, uint256 amountB) external nonReentrant {
        if (amountA == 0 && amountB == 0) revert ZeroAmount();
        if (amountA > 0) tokenA.safeTransferFrom(msg.sender, address(this), amountA);
        if (amountB > 0) tokenB.safeTransferFrom(msg.sender, address(this), amountB);
        reserveA = tokenA.balanceOf(address(this));
        reserveB = tokenB.balanceOf(address(this));
        emit LiquidityAdded(msg.sender, amountA, amountB);
    }

    /// @notice Swap exact `amountIn` of `tokenIn` for at least `minOut` of the other token.
    ///         Standard Uniswap v2 `getAmountOut` math with a 0.3% fee.
    function swap(
        address tokenIn,
        uint256 amountIn,
        uint256 minOut,
        address to
    ) external nonReentrant returns (uint256 amountOut) {
        if (amountIn == 0) revert ZeroAmount();
        bool aIn = tokenIn == address(tokenA);
        if (!aIn && tokenIn != address(tokenB)) revert UnknownToken();

        IERC20 inT = aIn ? tokenA : tokenB;
        IERC20 outT = aIn ? tokenB : tokenA;
        uint256 reserveIn = aIn ? reserveA : reserveB;
        uint256 reserveOut = aIn ? reserveB : reserveA;

        if (reserveIn == 0 || reserveOut == 0) revert InsufficientLiquidity();

        amountOut = _getAmountOut(amountIn, reserveIn, reserveOut);
        if (amountOut < minOut) revert InsufficientOutput();

        inT.safeTransferFrom(msg.sender, address(this), amountIn);
        outT.safeTransfer(to, amountOut);

        // Refresh reserves from balance — robust to fee-on-transfer, but neither
        // mock has that.
        reserveA = tokenA.balanceOf(address(this));
        reserveB = tokenB.balanceOf(address(this));

        emit Swap(msg.sender, tokenIn, amountIn, address(outT), amountOut, to);
    }

    /// @notice Quote helper. Pure math, no state.
    function getAmountOut(
        uint256 amountIn,
        uint256 reserveIn,
        uint256 reserveOut
    ) external pure returns (uint256) {
        return _getAmountOut(amountIn, reserveIn, reserveOut);
    }

    /// @notice Spot price of `tokenA` denominated in `tokenB`, scaled to 1e18.
    function spotPriceAInB() external view returns (uint256) {
        if (reserveA == 0) return 0;
        return (reserveB * 1e18) / reserveA;
    }

    /// @notice Spot price of `tokenB` denominated in `tokenA`, scaled to 1e18.
    function spotPriceBInA() external view returns (uint256) {
        if (reserveB == 0) return 0;
        return (reserveA * 1e18) / reserveB;
    }

    function _getAmountOut(
        uint256 amountIn,
        uint256 reserveIn,
        uint256 reserveOut
    ) internal pure returns (uint256) {
        if (amountIn == 0) revert ZeroAmount();
        if (reserveIn == 0 || reserveOut == 0) revert InsufficientLiquidity();
        uint256 amountInWithFee = amountIn * FEE_NUM;
        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = (reserveIn * FEE_DEN) + amountInWithFee;
        return numerator / denominator;
    }
}
