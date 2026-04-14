// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title  IStrategy
/// @author Atlas
/// @notice Minimal interface every Atlas strategy contract must implement.
///         Follows the Yearn V3 shape: debt tracking lives on the vault, the
///         strategy reports gains/losses via `report()`, the vault allocates
///         and revokes capital.
interface IStrategy {
    /// @notice Total assets controlled by this strategy, denominated in the
    ///         vault's settlement token. Equivalent to `balanceOfAsset() +
    ///         balanceOfVolatileConvertedToAsset()`. Read-only.
    function totalAssets() external view returns (uint256);

    /// @notice Report P&L to the vault. Returns (profit, loss) where exactly
    ///         one will be non-zero. Only callable by the strategy's vault.
    function report() external returns (uint256 profit, uint256 loss);

    /// @notice Pull `amount` of the settlement token back into the vault.
    ///         Strategy MUST sell volatile positions if necessary. Returns
    ///         the amount actually returned (may be less than requested on
    ///         loss). Vault-only.
    function returnToVault(uint256 amount) external returns (uint256 returned);

    /// @notice Receive `amount` of the settlement token from the vault and
    ///         deploy it per strategy logic. Vault-only.
    function deployCapital(uint256 amount) external;

    /// @notice Sub-wallet address holding this strategy's positions.
    function subWallet() external view returns (address);

    /// @notice Human-readable strategy name.
    function name() external view returns (string memory);
}
