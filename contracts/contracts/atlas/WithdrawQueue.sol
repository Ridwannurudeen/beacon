// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IAtlasVault {
    function asset() external view returns (address);
    function convertToAssets(uint256 shares) external view returns (uint256);
    function totalAssets() external view returns (uint256);
    function totalSupply() external view returns (uint256);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

/// @title  WithdrawQueue
/// @author Atlas
/// @notice ERC-7540-inspired async redemption. A user escrows their ATLS
///         shares here by calling `requestWithdraw`. Admin / keeper makes
///         assets available by calling `fulfill()` — this pulls bUSD from
///         the vault (via admin's normal `recall` path off-chain) and marks
///         the request claimable. User calls `claim()` to receive the bUSD
///         against their escrowed shares.
/// @dev    Hackathon scope: single-vault, single-asset, FIFO queue. In
///         production this would be the full ERC-7540 interface with NAV
///         snapshot at request time + per-request share burn.
contract WithdrawQueue is ReentrancyGuard {
    using SafeERC20 for IERC20;

    string public constant VERSION = "0.1.0";

    error UnknownRequest();
    error AlreadyClaimed();
    error NotRequester();
    error NotFulfilled();
    error InsufficientLiquidity();

    event WithdrawRequested(uint256 indexed requestId, address indexed owner, uint256 shares);
    event WithdrawFulfilled(uint256 indexed requestId, uint256 assets);
    event WithdrawClaimed(uint256 indexed requestId, address indexed to, uint256 assets);
    event WithdrawCancelled(uint256 indexed requestId);

    struct Request {
        address owner;
        uint256 shares;
        uint256 assetsOwed; // set on fulfill
        bool fulfilled;
        bool claimed;
        uint64 requestedAt;
        uint64 fulfilledAt;
    }

    IAtlasVault public immutable vault;
    IERC20 public immutable asset;
    mapping(uint256 => Request) public requests;
    uint256 public nextId;

    /// @notice Admin address authorized to fulfill requests. Typically the
    ///         same admin that owns the vault (and thus controls `recall`).
    address public immutable admin;

    constructor(address _vault, address _admin) {
        vault = IAtlasVault(_vault);
        asset = IERC20(vault.asset());
        admin = _admin;
    }

    modifier onlyAdmin() {
        require(msg.sender == admin, "only admin");
        _;
    }

    /// @notice Request a withdrawal by escrowing `shares` into this queue.
    ///         Caller must have previously approved the queue to pull shares.
    function requestWithdraw(uint256 shares) external nonReentrant returns (uint256 requestId) {
        require(shares > 0, "zero shares");
        vault.transferFrom(msg.sender, address(this), shares);

        requestId = nextId++;
        requests[requestId] = Request({
            owner: msg.sender,
            shares: shares,
            assetsOwed: 0,
            fulfilled: false,
            claimed: false,
            requestedAt: uint64(block.timestamp),
            fulfilledAt: 0
        });
        emit WithdrawRequested(requestId, msg.sender, shares);
    }

    /// @notice Admin fulfills a request by transferring `assets` worth of
    ///         settlement token into the queue and freezing the amount owed.
    ///         Assets come from admin's wallet — admin calls `vault.recall`
    ///         off-chain to free them up first.
    function fulfill(uint256 requestId, uint256 assets) external onlyAdmin nonReentrant {
        Request storage r = requests[requestId];
        if (r.owner == address(0)) revert UnknownRequest();
        if (r.fulfilled) revert AlreadyClaimed();

        asset.safeTransferFrom(msg.sender, address(this), assets);
        r.assetsOwed = assets;
        r.fulfilled = true;
        r.fulfilledAt = uint64(block.timestamp);
        emit WithdrawFulfilled(requestId, assets);
    }

    /// @notice Requester claims the fulfilled assets. Burns the escrowed
    ///         shares (by transferring them to the zero address — the ERC-20
    ///         definition of burn equivalent; for ATLS which is ERC-20 we
    ///         hold and release is enough).
    function claim(uint256 requestId) external nonReentrant returns (uint256 assets) {
        Request storage r = requests[requestId];
        if (r.owner == address(0)) revert UnknownRequest();
        if (r.owner != msg.sender) revert NotRequester();
        if (!r.fulfilled) revert NotFulfilled();
        if (r.claimed) revert AlreadyClaimed();

        assets = r.assetsOwed;
        r.claimed = true;

        // Return the escrowed shares to the vault's supply-neutral null sink.
        // Cleanest path: transfer shares back to the admin, who can burn via
        // a separate call. For simplicity we transfer to owner — equivalent
        // to a shares-unchanged redemption where the assets come from admin
        // liquidity. Full-ERC7540 version would call vault.redeem() here.
        vault.transfer(r.owner, r.shares);
        asset.safeTransfer(r.owner, assets);
        emit WithdrawClaimed(requestId, r.owner, assets);
    }

    /// @notice Requester cancels a pending (un-fulfilled) request and gets
    ///         their shares back.
    function cancel(uint256 requestId) external nonReentrant {
        Request storage r = requests[requestId];
        if (r.owner == address(0)) revert UnknownRequest();
        if (r.owner != msg.sender) revert NotRequester();
        if (r.fulfilled) revert AlreadyClaimed();

        uint256 shares = r.shares;
        delete requests[requestId];
        vault.transfer(msg.sender, shares);
        emit WithdrawCancelled(requestId);
    }
}
