// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title  AgentRegistry
/// @author Atlas
/// @notice On-chain rolodex + scoreboard of every Atlas trading agent. Stores each
///         agent's wallet, strategy name, starting capital, cumulative on-chain
///         metrics (trades, signal spend, gross PnL), and a public leaderboard
///         array. Anyone can register an agent — Atlas is permissionless. The
///         vault's allocator filters by reputation, not gatekeeping at the
///         registry layer.
/// @dev    Each agent is keyed by `keccak(wallet)` so the same wallet can't
///         register twice. Trade and signal accounting is push-based: the agent
///         (or its owner) emits the events. Off-chain indexers + the dashboard
///         compute live NAV by joining these events with current ERC-20 balances.
contract AgentRegistry {
    string public constant VERSION = "0.1.0";

    error AlreadyRegistered();
    error UnknownAgent();
    error NotAgent();
    error EmptyName();

    event AgentRegistered(
        bytes32 indexed agentId,
        address indexed wallet,
        string name,
        string strategy,
        uint256 startingCapital
    );

    /// @notice Emitted on every trade an agent executes. `pnlDelta` is the
    ///         signed PnL impact in bUSD base units, computed off-chain from
    ///         the swap quote at execution time.
    event AgentTraded(
        bytes32 indexed agentId,
        address indexed tokenIn,
        uint256 amountIn,
        address indexed tokenOut,
        uint256 amountOut,
        int256 pnlDelta,
        bytes32 txHash
    );

    /// @notice Emitted when an agent pays for a Beacon signal. `cost` is in
    ///         settlement-token base units. `signalSlug` is the consumed signal.
    event SignalConsumed(
        bytes32 indexed agentId,
        string signalSlug,
        uint256 cost,
        bytes32 settlementTx
    );

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

    mapping(bytes32 => Agent) public agents;
    bytes32[] public agentIds;

    /// @notice Registers a new agent. The caller becomes the agent's wallet.
    function register(
        string calldata name,
        string calldata strategy,
        uint256 startingCapital
    ) external returns (bytes32 agentId) {
        if (bytes(name).length == 0) revert EmptyName();
        agentId = keccak256(abi.encodePacked(msg.sender));
        if (agents[agentId].wallet != address(0)) revert AlreadyRegistered();

        agents[agentId] = Agent({
            wallet: msg.sender,
            name: name,
            strategy: strategy,
            startingCapital: startingCapital,
            registeredAt: uint64(block.timestamp),
            tradeCount: 0,
            signalCount: 0,
            cumulativeSignalSpend: 0,
            cumulativePnL: 0
        });
        agentIds.push(agentId);
        emit AgentRegistered(agentId, msg.sender, name, strategy, startingCapital);
    }

    /// @notice Reports a trade. Agent-only.
    function recordTrade(
        address tokenIn,
        uint256 amountIn,
        address tokenOut,
        uint256 amountOut,
        int256 pnlDelta,
        bytes32 txHash
    ) external {
        bytes32 id = keccak256(abi.encodePacked(msg.sender));
        Agent storage a = agents[id];
        if (a.wallet != msg.sender) revert NotAgent();
        unchecked {
            a.tradeCount += 1;
            a.cumulativePnL += pnlDelta;
        }
        emit AgentTraded(id, tokenIn, amountIn, tokenOut, amountOut, pnlDelta, txHash);
    }

    /// @notice Reports a Beacon signal consumption. Agent-only.
    function recordSignal(
        string calldata signalSlug,
        uint256 cost,
        bytes32 settlementTx
    ) external {
        bytes32 id = keccak256(abi.encodePacked(msg.sender));
        Agent storage a = agents[id];
        if (a.wallet != msg.sender) revert NotAgent();
        unchecked {
            a.signalCount += 1;
            a.cumulativeSignalSpend += cost;
            a.cumulativePnL -= int256(cost);
        }
        emit SignalConsumed(id, signalSlug, cost, settlementTx);
    }

    function totalAgents() external view returns (uint256) {
        return agentIds.length;
    }

    /// @notice Returns the agent id for a given wallet address.
    function agentIdOf(address wallet) external pure returns (bytes32) {
        return keccak256(abi.encodePacked(wallet));
    }
}
