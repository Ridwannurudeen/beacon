// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title FixedPriceSource
/// @notice Minimal IPriceSource implementation that returns a static price.
///         Used at mainnet deploy time before a real Uniswap-v3-backed price
///         feed is available. Owner can update the price as needed; the
///         downstream TwapOracle smooths it over its 30-min window so single
///         updates can't move NAV instantly.
contract FixedPriceSource {
    address public owner;
    uint256 private _price;

    event PriceUpdated(uint256 price);
    event OwnershipTransferred(address indexed from, address indexed to);

    constructor(uint256 initialPrice) {
        owner = msg.sender;
        _price = initialPrice;
        emit PriceUpdated(initialPrice);
    }

    /// @notice Returns price of token B (e.g. WOKB) priced in token A (USDT),
    ///         scaled to 1e18.
    function spotPriceBInA() external view returns (uint256) {
        return _price;
    }

    function setPrice(uint256 newPrice) external {
        require(msg.sender == owner, "not owner");
        _price = newPrice;
        emit PriceUpdated(newPrice);
    }

    function transferOwnership(address newOwner) external {
        require(msg.sender == owner, "not owner");
        require(newOwner != address(0), "zero owner");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
}
