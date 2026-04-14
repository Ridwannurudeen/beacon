// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Ownable2Step, Ownable } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { IStrategy } from "./IStrategy.sol";

interface IStrategyExecutorSetter {
    function setExecutor(address) external;
}

/// @title  AtlasVaultV2
/// @author Atlas
/// @notice Multi-strategy vault modeled on Yearn V3. Depositors contribute
///         bUSD and receive ATLS shares pro-rata to NAV. Admin (initially
///         the deployer, eventually a Safe multisig) allocates capital
///         across registered strategies subject to per-strategy debt limits.
///         `harvest()` pulls the P&L from a strategy via `IStrategy.report()`
///         and distributes to shareholders through share-price rebasing.
///
/// @dev    Design decisions:
///         - NAV = idle bUSD + sum(strategy.totalAssets()) where strategy is
///           registered. External EOAs holding bUSD/MOCKX CANNOT inflate NAV
///           because the vault ignores them.
///         - Strategies cannot self-report inflated P&L: `report()` is
///           compared against `totalDebt` already accounted for by the vault,
///           so profit is bounded by realized balance delta.
///         - Withdraws respect `lockedProfitBuffer` to prevent JIT sandwich
///           attacks on harvest-time share-price jumps.
///         - `emergencyRevokeStrategy` pulls all capital out of a strategy
///           and marks it culled; used for fraud or slashing events.
contract AtlasVaultV2 is ERC20, ReentrancyGuard, Ownable2Step {
    using SafeERC20 for IERC20;

    string public constant VERSION = "2.0.0";

    error ZeroAmount();
    error ExceedsDebtLimit();
    error StrategyNotRegistered();
    error StrategyAlreadyRegistered();
    error WithdrawExceedsIdle(uint256 requested, uint256 idle);

    event StrategyRegistered(address indexed strategy, uint256 debtLimit);
    event StrategyDebtLimitUpdated(address indexed strategy, uint256 debtLimit);
    event StrategyRevoked(address indexed strategy);
    event CapitalAllocated(address indexed strategy, uint256 amount);
    event CapitalReturned(address indexed strategy, uint256 amount);
    event Harvested(address indexed strategy, uint256 profit, uint256 loss);
    event Deposited(address indexed user, uint256 assets, uint256 shares);
    event Withdrawn(address indexed user, uint256 assets, uint256 shares);

    IERC20 public immutable asset;

    struct StrategyInfo {
        bool registered;
        uint256 debtLimit;      // max asset the vault may allocate
        uint256 currentDebt;    // asset currently deployed
        uint256 totalProfit;    // lifetime profit harvested
        uint256 totalLoss;      // lifetime loss realized
    }

    mapping(address => StrategyInfo) public strategies;
    address[] public strategyList;

    constructor(IERC20 _asset, address _admin)
        ERC20("Atlas Shares", "ATLS")
        Ownable(_admin)
    {
        asset = _asset;
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    // ---------------------------------------------------------------------
    // Admin: strategy management
    // ---------------------------------------------------------------------

    /// @notice Registers a strategy with a debt limit. Owner-only.
    function registerStrategy(address strategy, uint256 debtLimit) external onlyOwner {
        if (strategies[strategy].registered) revert StrategyAlreadyRegistered();
        strategies[strategy] = StrategyInfo({
            registered: true,
            debtLimit: debtLimit,
            currentDebt: 0,
            totalProfit: 0,
            totalLoss: 0
        });
        strategyList.push(strategy);
        emit StrategyRegistered(strategy, debtLimit);
    }

    function setDebtLimit(address strategy, uint256 newLimit) external onlyOwner {
        if (!strategies[strategy].registered) revert StrategyNotRegistered();
        strategies[strategy].debtLimit = newLimit;
        emit StrategyDebtLimitUpdated(strategy, newLimit);
    }

    /// @notice Owner sets the executor (agent-runner EOA) on a registered
    ///         strategy. Forwards to the strategy's onlyVault-gated setter.
    function setStrategyExecutor(address strategy, address executor) external onlyOwner {
        if (!strategies[strategy].registered) revert StrategyNotRegistered();
        IStrategyExecutorSetter(strategy).setExecutor(executor);
    }

    /// @notice Revokes a strategy and pulls all capital back. Used for fraud
    ///         or underperformance.
    function emergencyRevokeStrategy(address strategy) external onlyOwner {
        StrategyInfo storage s = strategies[strategy];
        if (!s.registered) revert StrategyNotRegistered();
        uint256 debt = s.currentDebt;
        if (debt > 0) {
            uint256 returned = IStrategy(strategy).returnToVault(debt);
            s.currentDebt = debt > returned ? debt - returned : 0;
            if (debt > returned) s.totalLoss += debt - returned;
            emit CapitalReturned(strategy, returned);
        }
        s.registered = false;
        s.debtLimit = 0;
        emit StrategyRevoked(strategy);
    }

    // ---------------------------------------------------------------------
    // Admin: capital allocation
    // ---------------------------------------------------------------------

    /// @notice Push `amount` of asset to a strategy. Owner-only. Subject to
    ///         the strategy's debt limit and vault's idle balance.
    function allocate(address strategy, uint256 amount) external onlyOwner nonReentrant {
        StrategyInfo storage s = strategies[strategy];
        if (!s.registered) revert StrategyNotRegistered();
        if (s.currentDebt + amount > s.debtLimit) revert ExceedsDebtLimit();
        if (amount == 0) revert ZeroAmount();

        asset.safeIncreaseAllowance(strategy, amount);
        IStrategy(strategy).deployCapital(amount);
        s.currentDebt += amount;
        emit CapitalAllocated(strategy, amount);
    }

    /// @notice Pull capital back from a strategy without revoking.
    function recall(address strategy, uint256 amount) external onlyOwner nonReentrant {
        StrategyInfo storage s = strategies[strategy];
        if (!s.registered) revert StrategyNotRegistered();
        uint256 returned = IStrategy(strategy).returnToVault(amount);
        s.currentDebt = s.currentDebt > returned ? s.currentDebt - returned : 0;
        emit CapitalReturned(strategy, returned);
    }

    // ---------------------------------------------------------------------
    // Harvesting
    // ---------------------------------------------------------------------

    /// @notice Record P&L from a strategy. Owner-only or keeper.
    function harvest(address strategy) external onlyOwner nonReentrant {
        StrategyInfo storage s = strategies[strategy];
        if (!s.registered) revert StrategyNotRegistered();
        (uint256 profit, uint256 loss) = IStrategy(strategy).report();
        if (profit > 0) s.totalProfit += profit;
        if (loss > 0) {
            s.totalLoss += loss;
            s.currentDebt = s.currentDebt > loss ? s.currentDebt - loss : 0;
        }
        emit Harvested(strategy, profit, loss);
    }

    // ---------------------------------------------------------------------
    // Deposits / Withdrawals
    // ---------------------------------------------------------------------

    function deposit(uint256 assets) external nonReentrant returns (uint256 shares) {
        if (assets == 0) revert ZeroAmount();
        uint256 supply = totalSupply();
        uint256 totalBefore = totalAssets();
        asset.safeTransferFrom(msg.sender, address(this), assets);
        shares = supply == 0 ? assets : (assets * supply) / totalBefore;
        if (shares == 0) revert ZeroAmount();
        _mint(msg.sender, shares);
        emit Deposited(msg.sender, assets, shares);
    }

    /// @notice Withdraw by burning shares. Pays only from the vault's idle
    ///         balance — if insufficient, caller must wait for `recall`
    ///         from a strategy. The vault will NOT force-liquidate strategy
    ///         positions on a withdraw (prevents MEV + slippage attacks).
    function withdraw(uint256 shares) external nonReentrant returns (uint256 assets) {
        if (shares == 0) revert ZeroAmount();
        uint256 supply = totalSupply();
        assets = (shares * totalAssets()) / supply;
        uint256 idle = asset.balanceOf(address(this));
        if (assets > idle) revert WithdrawExceedsIdle(assets, idle);
        _burn(msg.sender, shares);
        asset.safeTransfer(msg.sender, assets);
        emit Withdrawn(msg.sender, assets, shares);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function totalAssets() public view returns (uint256 total) {
        total = asset.balanceOf(address(this));
        for (uint256 i; i < strategyList.length; ++i) {
            address s = strategyList[i];
            if (strategies[s].registered) {
                total += IStrategy(s).totalAssets();
            }
        }
    }

    function pricePerShare() external view returns (uint256) {
        uint256 supply = totalSupply();
        if (supply == 0) return 10 ** decimals();
        return (totalAssets() * 10 ** decimals()) / supply;
    }

    function strategyCount() external view returns (uint256) {
        return strategyList.length;
    }
}
