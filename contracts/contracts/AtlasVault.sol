// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IAgentRegistry {
    struct Agent {
        address wallet;
        string name;
        string strategy;
        uint256 startingCapital;
        uint64 registeredAt;
        uint256 tradeCount;
        uint256 signalCount;
        uint256 cumulativeSignalSpend;
        int256 cumulativePnL;
    }

    function totalAgents() external view returns (uint256);

    function agentIds(uint256 index) external view returns (bytes32);

    function agents(bytes32 id) external view returns (
        address wallet,
        string memory name,
        string memory strategy,
        uint256 startingCapital,
        uint64 registeredAt,
        uint256 tradeCount,
        uint256 signalCount,
        uint256 cumulativeSignalSpend,
        int256 cumulativePnL
    );
}

interface IDemoAMM {
    function spotPriceBInA() external view returns (uint256);
}

/// @title  AtlasVault
/// @author Atlas
/// @notice Decentralized AI hedge fund vault. Depositors mint ATLS shares with
///         bUSD, and shares track the live equity of the autonomous agent pool.
///         Equity is computed on the fly from each registered agent's wallet
///         balance plus the vault's idle bUSD, valued at the AMM's spot price.
/// @dev    Simplified ERC-4626-shaped contract. `totalAssets()` walks the agent
///         registry — bounded by hackathon agent count (target: 3-5). For
///         production the registry would batch via a Multicall snapshot or a
///         keeper-pushed accumulator; this implementation prioritizes auditable
///         on-chain math.
contract AtlasVault is ERC20, ReentrancyGuard {
    using SafeERC20 for IERC20;

    string public constant VERSION = "0.1.0";

    error ZeroAmount();
    error InsufficientShares();

    event Deposited(address indexed user, uint256 assets, uint256 shares);
    event Withdrawn(address indexed user, uint256 assets, uint256 shares);

    IERC20 public immutable bUSD;
    IERC20 public immutable mockX;
    IAgentRegistry public immutable registry;
    IDemoAMM public immutable amm;

    constructor(
        IERC20 _bUSD,
        IERC20 _mockX,
        IAgentRegistry _registry,
        IDemoAMM _amm
    ) ERC20("Atlas Shares", "ATLS") {
        bUSD = _bUSD;
        mockX = _mockX;
        registry = _registry;
        amm = _amm;
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Deposit bUSD, receive ATLS shares pro-rata to current NAV.
    function deposit(uint256 assets) external nonReentrant returns (uint256 shares) {
        if (assets == 0) revert ZeroAmount();

        uint256 supply = totalSupply();
        uint256 totalAssetsBefore = _totalAssets();

        // Pull bUSD before computing shares so the in/out math is consistent.
        bUSD.safeTransferFrom(msg.sender, address(this), assets);

        // Shares = assets * supply / totalAssetsBefore. First deposit is 1:1.
        shares = supply == 0 ? assets : (assets * supply) / totalAssetsBefore;
        if (shares == 0) revert ZeroAmount();
        _mint(msg.sender, shares);

        emit Deposited(msg.sender, assets, shares);
    }

    /// @notice Burn shares, receive bUSD pro-rata. Withdraws come from the
    ///         vault's idle bUSD only — agent books are not force-liquidated.
    ///         If the vault hasn't accrued enough idle bUSD (because most is
    ///         deployed to agents), the call reverts and the user must wait
    ///         for the next harvest.
    function withdraw(uint256 shares) external nonReentrant returns (uint256 assets) {
        if (shares == 0) revert ZeroAmount();
        if (balanceOf(msg.sender) < shares) revert InsufficientShares();

        uint256 supply = totalSupply();
        uint256 ta = _totalAssets();
        assets = (shares * ta) / supply;

        _burn(msg.sender, shares);
        bUSD.safeTransfer(msg.sender, assets);

        emit Withdrawn(msg.sender, assets, shares);
    }

    /// @notice Returns the live equity of the entire fund in bUSD base units.
    function totalAssets() external view returns (uint256) {
        return _totalAssets();
    }

    /// @notice Per-agent equity at current AMM spot.
    function agentEquity(address agentWallet) public view returns (uint256) {
        uint256 b = bUSD.balanceOf(agentWallet);
        uint256 x = mockX.balanceOf(agentWallet);
        return b + _quoteXInBUSD(x);
    }

    /// @notice Convert MOCK-X amount → bUSD value at current AMM spot.
    function _quoteXInBUSD(uint256 amount) internal view returns (uint256) {
        if (amount == 0) return 0;
        // spotPriceBInA returns bUSD-per-MOCKX scaled to 1e18.
        uint256 spot = amm.spotPriceBInA();
        return (amount * spot) / 1e18;
    }

    function _totalAssets() internal view returns (uint256 total) {
        total = bUSD.balanceOf(address(this));
        uint256 n = registry.totalAgents();
        for (uint256 i; i < n; ++i) {
            bytes32 id = registry.agentIds(i);
            (address wallet, , , , , , , , ) = registry.agents(id);
            if (wallet != address(0)) total += agentEquity(wallet);
        }
    }

    /// @notice NAV per share, scaled to bUSD decimals (6). Returns 1.000000 when
    ///         no shares are minted.
    function pricePerShare() external view returns (uint256) {
        uint256 supply = totalSupply();
        if (supply == 0) return 10 ** decimals();
        return (_totalAssets() * 10 ** decimals()) / supply;
    }
}
