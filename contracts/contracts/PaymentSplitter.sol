// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title  PaymentSplitter
/// @author Beacon
/// @notice Pull-based multi-recipient splitter used by composite signals to fan out a
///         single incoming x402 payment across upstream authors by basis-point shares.
/// @dev    The composite server receives x402 settlement from the buyer, approves this
///         contract, and calls `distribute()`. Upstream authors claim at their convenience.
///         Pull-over-push prevents griefing from any single recipient reverting on receive.
contract PaymentSplitter is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------------

    string public constant VERSION = "0.1.0";
    uint16 public constant BPS_DENOMINATOR = 10_000;

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error LengthMismatch();
    error NoRecipients();
    error ZeroAmount();
    error ZeroRecipient();
    error BadShares();
    error NothingToClaim();

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    /// @notice Emitted on every `distribute` call, even if shares < 10_000 and a margin
    ///         is credited to the caller.
    event Distributed(
        bytes32 indexed signalId,
        address indexed composite,
        address indexed token,
        uint256 amount,
        address[] recipients,
        uint16[] shares,
        uint256 margin
    );

    event Claimed(address indexed recipient, address indexed token, uint256 amount);

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    /// @notice Pending claimable balance: recipient => token => amount.
    mapping(address => mapping(address => uint256)) public balanceOf;

    /// @notice Cumulative lifetime distribution per (composite, token). Useful for dashboards.
    mapping(address => mapping(address => uint256)) public distributedBy;

    // ---------------------------------------------------------------------
    // Distribute
    // ---------------------------------------------------------------------

    /// @notice Distribute `amount` of `token` across `recipients` by basis-point `shares`.
    ///         Caller must have approved this contract for `amount` beforehand.
    /// @param signalId   Composite signal id. Emitted for indexing; not validated.
    /// @param token      ERC-20 settlement token.
    /// @param amount     Amount in token base units.
    /// @param recipients Upstream addresses to credit.
    /// @param shares     Basis points per recipient. Sum in (0, 10_000].
    ///                   Any slack (10_000 - sum) is credited to `msg.sender` as margin.
    function distribute(
        bytes32 signalId,
        address token,
        uint256 amount,
        address[] calldata recipients,
        uint16[] calldata shares
    ) external nonReentrant {
        if (recipients.length != shares.length) revert LengthMismatch();
        if (recipients.length == 0) revert NoRecipients();
        if (amount == 0) revert ZeroAmount();

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        uint256 totalShares;
        uint256 distributed;
        for (uint256 i; i < recipients.length; ++i) {
            address r = recipients[i];
            if (r == address(0)) revert ZeroRecipient();
            uint16 bp = shares[i];
            totalShares += bp;
            uint256 cut = (amount * bp) / BPS_DENOMINATOR;
            balanceOf[r][token] += cut;
            distributed += cut;
        }
        if (totalShares == 0 || totalShares > BPS_DENOMINATOR) revert BadShares();

        uint256 margin = amount - distributed;
        if (margin > 0) {
            balanceOf[msg.sender][token] += margin;
        }

        distributedBy[msg.sender][token] += amount;

        emit Distributed(signalId, msg.sender, token, amount, recipients, shares, margin);
    }

    // ---------------------------------------------------------------------
    // Claim
    // ---------------------------------------------------------------------

    /// @notice Pulls the caller's accumulated balance for `token`.
    function claim(address token) external nonReentrant returns (uint256 amount) {
        amount = balanceOf[msg.sender][token];
        if (amount == 0) revert NothingToClaim();
        balanceOf[msg.sender][token] = 0;
        IERC20(token).safeTransfer(msg.sender, amount);
        emit Claimed(msg.sender, token, amount);
    }
}
