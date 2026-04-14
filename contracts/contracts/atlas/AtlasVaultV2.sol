// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
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
/// @notice Multi-strategy vault modeled on Yearn V3 with full ERC-4626 surface.
///         Depositors contribute `asset` and receive ATLS shares pro-rata to
///         NAV. `harvest()` is permissionless so keepers can maintain up-to-
///         date P&L; a TimelockController wraps the admin owner for all
///         mutating admin actions (registerStrategy, emergencyRevokeStrategy,
///         setDebtLimit, setStrategyExecutor, recall, allocate).
/// @dev    NAV = idle asset + Σ registered strategy equity. External EOAs
///         holding bUSD/MOCKX cannot inflate NAV because the vault ignores
///         them. `harvest()` is nonReentrant and re-entrant-safe: it reads
///         profit/loss from strategy before mutating vault state.
contract AtlasVaultV2 is ERC20, ReentrancyGuard, Ownable2Step {
    using SafeERC20 for IERC20;

    string public constant VERSION = "2.0.0";

    error ZeroAmount();
    error ZeroAddress();
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

    /// @notice ERC-4626 standard events (added for compliance with integrator expectations).
    event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares);
    event Withdraw(
        address indexed sender,
        address indexed receiver,
        address indexed owner,
        uint256 assets,
        uint256 shares
    );

    IERC20 private immutable _asset;

    struct StrategyInfo {
        bool registered;
        uint256 debtLimit;
        uint256 currentDebt;
        uint256 totalProfit;
        uint256 totalLoss;
    }

    mapping(address => StrategyInfo) public strategies;
    address[] public strategyList;

    constructor(IERC20 asset_, address _admin)
        ERC20("Atlas Shares", "ATLS")
        Ownable(_admin)
    {
        if (address(asset_) == address(0)) revert ZeroAddress();
        _asset = asset_;
    }

    // ---------------------------------------------------------------------
    // ERC-4626 surface
    // ---------------------------------------------------------------------

    /// @notice The underlying asset token. Matches bUSD decimals.
    function asset() public view returns (address) {
        return address(_asset);
    }

    function decimals() public view override returns (uint8) {
        return IERC20Metadata(address(_asset)).decimals();
    }

    /// @notice Total assets under management, denominated in the asset token.
    function totalAssets() public view returns (uint256 total) {
        total = _asset.balanceOf(address(this));
        uint256 len = strategyList.length;
        for (uint256 i; i < len; ++i) {
            address s = strategyList[i];
            if (strategies[s].registered) {
                total += IStrategy(s).totalAssets();
            }
        }
    }

    function convertToShares(uint256 assets) public view returns (uint256) {
        uint256 supply = totalSupply();
        uint256 ta = totalAssets();
        if (supply == 0 || ta == 0) return assets;
        return (assets * supply) / ta;
    }

    function convertToAssets(uint256 shares) public view returns (uint256) {
        uint256 supply = totalSupply();
        if (supply == 0) return shares;
        return (shares * totalAssets()) / supply;
    }

    function maxDeposit(address) external pure returns (uint256) {
        return type(uint256).max;
    }

    function maxMint(address) external pure returns (uint256) {
        return type(uint256).max;
    }

    /// @notice ERC-4626 cap on withdraw — limited by the vault's idle balance.
    function maxWithdraw(address owner_) external view returns (uint256) {
        uint256 owed = convertToAssets(balanceOf(owner_));
        uint256 idle = _asset.balanceOf(address(this));
        return owed < idle ? owed : idle;
    }

    function maxRedeem(address owner_) external view returns (uint256) {
        uint256 idle = _asset.balanceOf(address(this));
        uint256 idleShares = convertToShares(idle);
        uint256 bal = balanceOf(owner_);
        return bal < idleShares ? bal : idleShares;
    }

    function previewDeposit(uint256 assets) external view returns (uint256) {
        return convertToShares(assets);
    }

    function previewMint(uint256 shares) external view returns (uint256) {
        uint256 supply = totalSupply();
        if (supply == 0) return shares;
        return (shares * totalAssets() + supply - 1) / supply;
    }

    function previewWithdraw(uint256 assets) external view returns (uint256) {
        uint256 supply = totalSupply();
        uint256 ta = totalAssets();
        if (supply == 0 || ta == 0) return assets;
        return (assets * supply + ta - 1) / ta;
    }

    function previewRedeem(uint256 shares) external view returns (uint256) {
        return convertToAssets(shares);
    }

    /// @notice ERC-4626 deposit. `receiver` receives the minted shares.
    function deposit(uint256 assets, address receiver) public nonReentrant returns (uint256 shares) {
        if (assets == 0) revert ZeroAmount();
        if (receiver == address(0)) revert ZeroAddress();
        uint256 supply = totalSupply();
        uint256 totalBefore = totalAssets();
        _asset.safeTransferFrom(msg.sender, address(this), assets);
        shares = supply == 0 ? assets : (assets * supply) / totalBefore;
        if (shares == 0) revert ZeroAmount();
        _mint(receiver, shares);
        emit Deposit(msg.sender, receiver, assets, shares);
    }

    /// @notice Legacy one-arg wrapper. Mints to msg.sender.
    function deposit(uint256 assets) external returns (uint256 shares) {
        return deposit(assets, msg.sender);
    }

    /// @notice ERC-4626 mint. Caller specifies share amount; required assets computed.
    function mint(uint256 shares, address receiver) external nonReentrant returns (uint256 assets) {
        if (shares == 0) revert ZeroAmount();
        if (receiver == address(0)) revert ZeroAddress();
        uint256 supply = totalSupply();
        assets = supply == 0 ? shares : (shares * totalAssets() + supply - 1) / supply;
        _asset.safeTransferFrom(msg.sender, address(this), assets);
        _mint(receiver, shares);
        emit Deposit(msg.sender, receiver, assets, shares);
    }

    /// @notice ERC-4626 withdraw. Pulls from idle balance only.
    function withdraw(
        uint256 assets,
        address receiver,
        address owner_
    ) public nonReentrant returns (uint256 shares) {
        if (assets == 0) revert ZeroAmount();
        if (receiver == address(0) || owner_ == address(0)) revert ZeroAddress();
        uint256 supply = totalSupply();
        uint256 ta = totalAssets();
        shares = supply == 0 ? assets : (assets * supply + ta - 1) / ta;
        uint256 idle = _asset.balanceOf(address(this));
        if (assets > idle) revert WithdrawExceedsIdle(assets, idle);
        if (msg.sender != owner_) _spendAllowance(owner_, msg.sender, shares);
        _burn(owner_, shares);
        _asset.safeTransfer(receiver, assets);
        emit Withdraw(msg.sender, receiver, owner_, assets, shares);
    }

    /// @notice Legacy one-arg wrapper. Burns caller's shares to caller.
    function withdraw(uint256 shares) external returns (uint256 assets) {
        assets = convertToAssets(shares);
        withdraw(assets, msg.sender, msg.sender);
    }

    function redeem(
        uint256 shares,
        address receiver,
        address owner_
    ) external nonReentrant returns (uint256 assets) {
        if (shares == 0) revert ZeroAmount();
        if (receiver == address(0) || owner_ == address(0)) revert ZeroAddress();
        assets = convertToAssets(shares);
        uint256 idle = _asset.balanceOf(address(this));
        if (assets > idle) revert WithdrawExceedsIdle(assets, idle);
        if (msg.sender != owner_) _spendAllowance(owner_, msg.sender, shares);
        _burn(owner_, shares);
        _asset.safeTransfer(receiver, assets);
        emit Withdraw(msg.sender, receiver, owner_, assets, shares);
    }

    // ---------------------------------------------------------------------
    // Admin: strategy management (timelock-wrapped in production)
    // ---------------------------------------------------------------------

    function registerStrategy(address strategy, uint256 debtLimit) external onlyOwner {
        if (strategies[strategy].registered) revert StrategyAlreadyRegistered();
        if (strategy == address(0)) revert ZeroAddress();
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

    function setStrategyExecutor(address strategy, address executor) external onlyOwner {
        if (!strategies[strategy].registered) revert StrategyNotRegistered();
        IStrategyExecutorSetter(strategy).setExecutor(executor);
    }

    function emergencyRevokeStrategy(address strategy) external onlyOwner nonReentrant {
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
    // Capital allocation (owner)
    // ---------------------------------------------------------------------

    function allocate(address strategy, uint256 amount) external onlyOwner nonReentrant {
        StrategyInfo storage s = strategies[strategy];
        if (!s.registered) revert StrategyNotRegistered();
        if (s.currentDebt + amount > s.debtLimit) revert ExceedsDebtLimit();
        if (amount == 0) revert ZeroAmount();

        _asset.safeIncreaseAllowance(strategy, amount);
        IStrategy(strategy).deployCapital(amount);
        s.currentDebt += amount;
        emit CapitalAllocated(strategy, amount);
    }

    function recall(address strategy, uint256 amount) external onlyOwner nonReentrant {
        StrategyInfo storage s = strategies[strategy];
        if (!s.registered) revert StrategyNotRegistered();
        uint256 returned = IStrategy(strategy).returnToVault(amount);
        s.currentDebt = s.currentDebt > returned ? s.currentDebt - returned : 0;
        emit CapitalReturned(strategy, returned);
    }

    // ---------------------------------------------------------------------
    // Permissionless keeper-style harvest
    // ---------------------------------------------------------------------

    /// @notice Record P&L from a strategy. Permissionless so keepers / bots
    ///         can maintain fresh NAV without admin intervention. Effects are
    ///         bounded by the strategy's prior `currentDebt`, so a bad actor
    ///         cannot inject profit — only record reality.
    function harvest(address strategy) external nonReentrant {
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
    // Convenience views
    // ---------------------------------------------------------------------

    function pricePerShare() external view returns (uint256) {
        uint256 supply = totalSupply();
        if (supply == 0) return 10 ** decimals();
        return (totalAssets() * 10 ** decimals()) / supply;
    }

    function strategyCount() external view returns (uint256) {
        return strategyList.length;
    }
}
