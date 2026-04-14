// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IStrategy } from "./IStrategy.sol";
import { SubWallet } from "./SubWallet.sol";

/// @title  StrategyBase
/// @author Atlas
/// @notice Abstract base class for Atlas strategies. Wires the vault/sub-wallet
///         invariant (strategy has no EOA, all positions live in a vault-
///         controlled SubWallet) and exposes a common harvest lifecycle. Each
///         concrete strategy overrides `_trade()` with its decision logic.
///
/// @dev    The harvest model is snapshot-based: each call to `report()`
///         compares the sub-wallet's current equity (denominated in the
///         settlement token at current spot) against `totalDebt` — the amount
///         the vault has handed the strategy so far. Positive delta is
///         profit, negative is loss. No agent-supplied PnL; the numbers come
///         from on-chain balances and an oracle / AMM spot price.
abstract contract StrategyBase is IStrategy {
    using SafeERC20 for IERC20;

    error OnlyVault();
    error ExecutorNotSet();
    error InsufficientReturn();

    address public immutable vault;
    IERC20 public immutable asset; // settlement token (bUSD)
    address public immutable override subWallet;
    string public override name;

    /// @notice Cumulative amount the vault has deployed to this strategy. The
    ///         harvest math compares current equity against this number.
    uint256 public totalDebt;

    /// @notice Executor authorized to call `submitAction` — typically the
    ///         agent-runner's EOA. The executor cannot move funds; it can
    ///         only trigger predefined on-chain actions via the sub-wallet.
    address public executor;

    event Executed(bytes32 indexed actionHash);
    event Harvested(uint256 profit, uint256 loss, uint256 totalAssets);
    event ExecutorSet(address indexed executor);

    constructor(address _vault, address _asset, string memory _name) {
        vault = _vault;
        asset = IERC20(_asset);
        name = _name;
        // Deploy the strategy's own sub-wallet, owned by address(this) so only
        // this strategy contract can invoke its execute.
        subWallet = address(new SubWallet(address(this)));
    }

    modifier onlyVault() {
        if (msg.sender != vault) revert OnlyVault();
        _;
    }

    modifier onlyExecutor() {
        if (msg.sender != executor || executor == address(0)) revert ExecutorNotSet();
        _;
    }

    /// @notice Vault designates who may submit actions. Swapping executors
    ///         lets a strategy rotate off a compromised agent without
    ///         redeploying the strategy contract.
    function setExecutor(address _executor) external onlyVault {
        executor = _executor;
        emit ExecutorSet(_executor);
    }

    /// @notice Abstract — each concrete strategy values its positions.
    function totalAssets() public view virtual override returns (uint256);

    /// @inheritdoc IStrategy
    function deployCapital(uint256 amount) external override onlyVault {
        // Vault has already called safeIncreaseAllowance(strategy, amount);
        // pull the capital into this contract, then forward to subWallet.
        asset.safeTransferFrom(vault, address(this), amount);
        asset.safeTransfer(subWallet, amount);
        totalDebt += amount;
    }

    /// @inheritdoc IStrategy
    function returnToVault(uint256 amount) external override onlyVault returns (uint256 returned) {
        // Concrete strategies may need to liquidate volatile positions first.
        returned = _liquidateForVault(amount);
        uint256 bal = asset.balanceOf(subWallet);
        uint256 toSend = returned > bal ? bal : returned;
        // Use the sub-wallet's execute to transfer; only the vault (us) can trigger it.
        SubWallet(payable(subWallet)).execute(
            address(asset),
            0,
            abi.encodeWithSelector(IERC20.transfer.selector, vault, toSend)
        );
        totalDebt = totalDebt > toSend ? totalDebt - toSend : 0;
        return toSend;
    }

    /// @inheritdoc IStrategy
    function report() external override onlyVault returns (uint256 profit, uint256 loss) {
        uint256 total = totalAssets();
        if (total >= totalDebt) {
            profit = total - totalDebt;
            loss = 0;
        } else {
            profit = 0;
            loss = totalDebt - total;
        }
        emit Harvested(profit, loss, total);
    }

    /// @notice Executor-callable entrypoint for a strategy action. The base
    ///         class validates + logs; concrete strategies override `_trade`
    ///         to implement the actual logic. Action hash covers args for
    ///         auditability.
    function submitAction(bytes calldata actionData) external onlyExecutor {
        bytes32 actionHash = keccak256(actionData);
        _trade(actionData);
        emit Executed(actionHash);
    }

    /// @dev Implemented by concrete strategies. May call sub-wallet to
    ///      approve, swap, borrow, etc. Must not transfer assets out of the
    ///      sub-wallet.
    function _trade(bytes calldata actionData) internal virtual;

    /// @dev Implemented by concrete strategies. Converts volatile positions
    ///      back into `asset` up to `amount`. Returns the amount of `asset`
    ///      that is now in the sub-wallet and ready to send to the vault.
    function _liquidateForVault(uint256 amount) internal virtual returns (uint256);
}
