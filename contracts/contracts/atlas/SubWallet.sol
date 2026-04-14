// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title  SubWallet
/// @author Atlas
/// @notice Minimal smart-wallet that only its declared `owner` strategy can
///         invoke. The strategy itself is vault-controlled — this chain of
///         custody means agents never touch user capital directly and no EOA
///         has authority over the positions.
contract SubWallet {
    error OnlyOwner();
    error ExecutionFailed(bytes data);

    event Executed(address indexed target, uint256 value, bytes data, bytes result);

    /// @notice Immutable owner — the strategy contract — assigned at construction.
    address public immutable owner;

    constructor(address _owner) {
        owner = _owner;
    }

    function execute(address target, uint256 value, bytes calldata data)
        external
        returns (bytes memory result)
    {
        if (msg.sender != owner) revert OnlyOwner();
        bool ok;
        (ok, result) = target.call{ value: value }(data);
        if (!ok) revert ExecutionFailed(result);
        emit Executed(target, value, data, result);
    }

    function batchExecute(
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata data
    ) external returns (bytes[] memory results) {
        if (msg.sender != owner) revert OnlyOwner();
        require(
            targets.length == values.length && values.length == data.length,
            "length mismatch"
        );
        results = new bytes[](targets.length);
        for (uint256 i; i < targets.length; ++i) {
            bool ok;
            bytes memory r;
            (ok, r) = targets[i].call{ value: values[i] }(data[i]);
            if (!ok) revert ExecutionFailed(r);
            results[i] = r;
            emit Executed(targets[i], values[i], data[i], r);
        }
    }

    receive() external payable {}
}
