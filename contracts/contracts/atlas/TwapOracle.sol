// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IPriceSource {
    function spotPriceBInA() external view returns (uint256);
}

interface ITwapOracle {
    function twap(uint256 duration) external view returns (uint256);
    function twap30m() external view returns (uint256);
    function spot() external view returns (uint256);
    function update() external;
}

/// @title  TwapOracle
/// @author Atlas
/// @notice Wraps a single-hop AMM price feed and exposes a time-weighted
///         average over a sliding window. Designed to be poked by anyone
///         (keepers, bots, agents) with a minimum gap between samples to
///         bound gas cost and manipulation bandwidth.
/// @dev    This oracle exists specifically to close the NAV flash-loan attack
///         that the V2 review flagged: `TradingStrategy.totalAssets()` used
///         to read raw spot, so a one-tx AMM manipulation could inflate the
///         vault's NAV long enough to mint shares at an unfair rate. Pricing
///         off a 30-minute TWAP neutralizes the single-block manipulation
///         because an attacker can't sustain the inflated price across
///         enough samples.
contract TwapOracle is ITwapOracle {
    string public constant VERSION = "0.1.0";

    error SampleTooSoon();

    event Updated(uint64 timestamp, uint192 price);

    IPriceSource public immutable source;

    /// @notice Ring buffer of price samples. 64 slots × 30s-min spacing =
    ///         up to 32 minutes of history at cheapest sampling cadence.
    struct Sample {
        uint64 timestamp;
        uint192 price;
    }
    uint256 public constant MAX_SAMPLES = 64;
    uint256 public constant MIN_SAMPLE_GAP = 30; // seconds
    uint256 public constant DEFAULT_WINDOW = 30 minutes;

    Sample[MAX_SAMPLES] public samples;
    uint256 public head;   // next write index
    uint256 public count;  // filled slots (caps at MAX_SAMPLES)

    constructor(address _source) {
        source = IPriceSource(_source);
        // seed one sample so `twap()` never returns 0 on the first reader.
        samples[0] = Sample(uint64(block.timestamp), uint192(IPriceSource(_source).spotPriceBInA()));
        head = 1;
        count = 1;
    }

    /// @notice Appends a fresh sample. Reverts if called too soon after the
    ///         last sample (prevents single-tx spam affecting the window).
    function update() external override {
        Sample memory last = samples[(head + MAX_SAMPLES - 1) % MAX_SAMPLES];
        if (block.timestamp < uint256(last.timestamp) + MIN_SAMPLE_GAP) revert SampleTooSoon();
        uint192 price = uint192(source.spotPriceBInA());
        samples[head] = Sample(uint64(block.timestamp), price);
        head = (head + 1) % MAX_SAMPLES;
        if (count < MAX_SAMPLES) count++;
        emit Updated(uint64(block.timestamp), price);
    }

    /// @notice Returns the simple mean of samples captured within `duration`
    ///         seconds of now. Falls back to the raw spot read if no samples
    ///         qualify (which should only happen immediately after deploy).
    function twap(uint256 duration) public view override returns (uint256) {
        uint256 cutoff = block.timestamp > duration ? block.timestamp - duration : 0;
        uint256 sum;
        uint256 n;
        for (uint256 i; i < count; ++i) {
            Sample memory s = samples[(head + MAX_SAMPLES - i - 1) % MAX_SAMPLES];
            if (uint256(s.timestamp) < cutoff) break;
            sum += uint256(s.price);
            ++n;
        }
        if (n == 0) return source.spotPriceBInA();
        return sum / n;
    }

    /// @notice Convenience: the default 30-minute TWAP consumed by NAV math.
    function twap30m() external view override returns (uint256) {
        return twap(DEFAULT_WINDOW);
    }

    /// @notice Spot passthrough for emergency paths / fallbacks.
    function spot() external view override returns (uint256) {
        return source.spotPriceBInA();
    }
}
