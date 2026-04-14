// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Ownable2Step, Ownable } from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title  SlashingRegistry
/// @author Atlas
/// @notice Stakes posted by Atlas strategies to be eligible for capital
///         allocation. Fraud claims open a challenge window; if not rebutted
///         in time, stake is slashed to a treasury. If the operator wins the
///         challenge, the claim is dismissed and the claimant loses their
///         bond.
/// @dev    Hackathon scope:
///         - Stakes are in `asset` (bUSD).
///         - `openClaim` posts a claimant bond; `rebut` by strategy operator
///           cancels, burns bond; `finalize` after window slashes.
///         - Governance (owner) can veto malicious claims as the escape
///           hatch.
contract SlashingRegistry is ReentrancyGuard, Ownable2Step {
    using SafeERC20 for IERC20;

    string public constant VERSION = "0.1.0";
    uint256 public constant CHALLENGE_WINDOW = 24 hours;

    error AlreadyStaked();
    error NotStaked();
    error StakeLocked();
    error NoClaim();
    error ClaimStillOpen();
    error ClaimAlreadyResolved();
    error WrongCaller();
    error InsufficientBond();

    event Staked(address indexed strategy, uint256 amount);
    event Unstaked(address indexed strategy, uint256 amount);
    event ClaimOpened(uint256 indexed claimId, address indexed strategy, address indexed claimant, string reason, uint256 bond);
    event ClaimRebutted(uint256 indexed claimId, bytes evidence);
    event ClaimFinalized(uint256 indexed claimId, bool slashed, uint256 amount);

    IERC20 public immutable asset;
    address public immutable treasury;
    uint256 public immutable minimumStake;
    uint256 public immutable minimumBond;

    struct Stake {
        uint256 amount;
        uint256 lockedUntil; // seconds
    }

    struct Claim {
        address strategy;
        address claimant;
        string reason;
        uint256 bond;
        uint256 openedAt;
        bool resolved;
        bool rebutted;
    }

    mapping(address => Stake) public stakes;
    mapping(uint256 => Claim) public claims;
    uint256 public nextClaimId;

    constructor(
        IERC20 _asset,
        address _admin,
        address _treasury,
        uint256 _minimumStake,
        uint256 _minimumBond
    ) Ownable(_admin) {
        asset = _asset;
        treasury = _treasury;
        minimumStake = _minimumStake;
        minimumBond = _minimumBond;
    }

    // ---------------------------------------------------------------------
    // Stake
    // ---------------------------------------------------------------------

    function stake(uint256 amount) external nonReentrant {
        if (stakes[msg.sender].amount > 0) revert AlreadyStaked();
        if (amount < minimumStake) revert InsufficientBond();
        asset.safeTransferFrom(msg.sender, address(this), amount);
        stakes[msg.sender] = Stake({ amount: amount, lockedUntil: 0 });
        emit Staked(msg.sender, amount);
    }

    /// @notice Withdraw the stake if no open claims exist against the strategy.
    function unstake() external nonReentrant {
        Stake memory s = stakes[msg.sender];
        if (s.amount == 0) revert NotStaked();
        if (block.timestamp < s.lockedUntil) revert StakeLocked();
        delete stakes[msg.sender];
        asset.safeTransfer(msg.sender, s.amount);
        emit Unstaked(msg.sender, s.amount);
    }

    // ---------------------------------------------------------------------
    // Fraud claim lifecycle
    // ---------------------------------------------------------------------

    /// @notice Anyone with a bond may open a fraud claim against a strategy.
    ///         This locks the strategy's stake until the claim resolves.
    function openClaim(
        address strategy,
        string calldata reason,
        uint256 bondAmount
    ) external nonReentrant returns (uint256 claimId) {
        if (stakes[strategy].amount == 0) revert NotStaked();
        if (bondAmount < minimumBond) revert InsufficientBond();

        asset.safeTransferFrom(msg.sender, address(this), bondAmount);
        stakes[strategy].lockedUntil = block.timestamp + CHALLENGE_WINDOW;

        claimId = nextClaimId++;
        claims[claimId] = Claim({
            strategy: strategy,
            claimant: msg.sender,
            reason: reason,
            bond: bondAmount,
            openedAt: block.timestamp,
            resolved: false,
            rebutted: false
        });
        emit ClaimOpened(claimId, strategy, msg.sender, reason, bondAmount);
    }

    /// @notice The strategy operator rebuts a fraud claim with evidence.
    ///         The admin reviews; if owner agrees (via `rejectRebuttal`),
    ///         the stake is still slashed. Otherwise the rebuttal wins by
    ///         default after the window — claimant loses bond.
    function rebut(uint256 claimId, bytes calldata evidence) external {
        Claim storage c = claims[claimId];
        if (c.strategy == address(0)) revert NoClaim();
        if (c.resolved) revert ClaimAlreadyResolved();
        if (msg.sender != c.strategy) revert WrongCaller();
        c.rebutted = true;
        emit ClaimRebutted(claimId, evidence);
    }

    /// @notice Admin override — rejects the rebuttal and forces slashing.
    function rejectRebuttal(uint256 claimId) external onlyOwner {
        Claim storage c = claims[claimId];
        if (c.strategy == address(0)) revert NoClaim();
        c.rebutted = false;
    }

    /// @notice Finalizes a claim after the challenge window.
    function finalize(uint256 claimId) external nonReentrant {
        Claim storage c = claims[claimId];
        if (c.strategy == address(0)) revert NoClaim();
        if (c.resolved) revert ClaimAlreadyResolved();
        if (block.timestamp < c.openedAt + CHALLENGE_WINDOW) revert ClaimStillOpen();

        c.resolved = true;
        stakes[c.strategy].lockedUntil = 0;

        if (c.rebutted) {
            // Claimant loses their bond to the treasury.
            asset.safeTransfer(treasury, c.bond);
            emit ClaimFinalized(claimId, false, 0);
        } else {
            // Slash the strategy's stake to the treasury, return bond to claimant.
            uint256 slashAmount = stakes[c.strategy].amount;
            delete stakes[c.strategy];
            asset.safeTransfer(treasury, slashAmount);
            asset.safeTransfer(c.claimant, c.bond);
            emit ClaimFinalized(claimId, true, slashAmount);
        }
    }
}
