// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { SubWallet } from "./SubWallet.sol";

/// @title  SubWalletFactory
/// @author Atlas
/// @notice Deterministic CREATE2 deployer for `SubWallet` instances. Each
///         strategy gets its own sub-wallet keyed by (vault, strategyId). The
///         vault knows the address up-front via `predict()`.
contract SubWalletFactory {
    event SubWalletCreated(address indexed vault, bytes32 indexed strategyId, address subWallet);

    /// @notice Deploys a new SubWallet owned by `vault`. Returns the deployed
    ///         address. Reverts if a wallet for (vault, strategyId) already
    ///         exists.
    function create(address vault, bytes32 strategyId) external returns (address subWallet) {
        subWallet = address(new SubWallet{ salt: _salt(vault, strategyId) }(vault));
        emit SubWalletCreated(vault, strategyId, subWallet);
    }

    /// @notice Predicts the deterministic SubWallet address for (vault, strategyId).
    function predict(address vault, bytes32 strategyId) external view returns (address) {
        bytes memory bytecode = abi.encodePacked(
            type(SubWallet).creationCode,
            abi.encode(vault)
        );
        bytes32 codeHash = keccak256(bytecode);
        bytes32 raw = keccak256(
            abi.encodePacked(bytes1(0xff), address(this), _salt(vault, strategyId), codeHash)
        );
        return address(uint160(uint256(raw)));
    }

    function _salt(address vault, bytes32 strategyId) internal pure returns (bytes32) {
        return keccak256(abi.encode(vault, strategyId));
    }
}
