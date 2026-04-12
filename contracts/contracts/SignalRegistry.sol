// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title  SignalRegistry
/// @author Beacon
/// @notice Canonical on-chain registry for Beacon signals. Records authorship, pricing,
///         composition, and verifiable call volume per signal. Permissionless to read and
///         register; state-changing operations are scoped to each signal's author.
/// @dev    Prices are in settlement-token base units (e.g. USDT0 uses 6 decimals). The
///         registry is the authoritative index discovered by the Signal SDK, the Beacon
///         MCP server, subgraphs, and external agents. Settlement itself happens off-chain
///         via x402 / EIP-3009 transferWithAuthorization; this contract records only the
///         outcome for aggregation.
contract SignalRegistry {
    // ---------------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------------

    string public constant VERSION = "0.1.0";
    uint16 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant MAX_SLUG_LEN = 64;

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error BadSlug();
    error BadUrl();
    error AlreadyRegistered();
    error NotAuthor();
    error Retired();
    error UnknownSignal();
    error LengthMismatch();
    error EmptyComposition();
    error UpstreamMissing();
    error UpstreamRetired();
    error SelfReference();
    error BadShares();
    error DuplicateSettlement();
    error ZeroPayer();

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    /// @notice Emitted when a signal is registered.
    /// @param signalId keccak256(author, slug).
    /// @param author   Address that controls the signal.
    /// @param slug     Human-readable identifier (lowercase, hyphenated).
    /// @param url      HTTPS endpoint that serves the signal.
    /// @param price    Per-call price in settlement-token base units.
    event SignalRegistered(
        bytes32 indexed signalId,
        address indexed author,
        string slug,
        string url,
        uint256 price
    );

    /// @notice Emitted when a signal's mutable fields are updated by its author.
    event SignalUpdated(bytes32 indexed signalId, string url, uint256 price);

    /// @notice Emitted when a signal is retired. Retired signals remain on-chain for audit.
    event SignalRetired(bytes32 indexed signalId);

    /// @notice Emitted when a composite declares its upstream dependencies. A composite may
    ///         re-emit this as composition evolves; only the latest stands.
    /// @param signalId Composite signal id.
    /// @param upstream Array of upstream signal ids.
    /// @param shares   Basis-point shares parallel to `upstream`. Sum in (0, 10_000].
    ///                 Any slack accrues to the composite author as margin, enforced at
    ///                 call time by PaymentSplitter.
    event CompositionSet(bytes32 indexed signalId, bytes32[] upstream, uint16[] shares);

    /// @notice Emitted by the signal's author after a successful x402 settlement. Gives
    ///         subgraphs and aggregators a cheap, per-signal index of verifiable activity.
    /// @param signalId   Signal that was called.
    /// @param payer      x402 payer (buyer's Agentic Wallet or EOA).
    /// @param amount     Amount paid, in settlement-token base units.
    /// @param settlement x402 settlement tx hash on X Layer. Unique per signal.
    event CallRecorded(
        bytes32 indexed signalId,
        address indexed payer,
        uint256 amount,
        bytes32 indexed settlement
    );

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    struct Signal {
        address author;
        string slug;
        string url;
        uint256 price;
        uint64 registeredAt;
        bool retired;
        uint256 callCount;
        uint256 cumulativeRevenue;
    }

    /// @notice Signals by id. `author == address(0)` means unset.
    mapping(bytes32 => Signal) public signals;

    /// @notice Reverse index: author => their signal ids in registration order.
    mapping(address => bytes32[]) private _signalsByAuthor;

    /// @notice Global list of all signal ids in registration order.
    bytes32[] private _allSignals;

    /// @notice Per-signal settlement dedup. Prevents double-counting the same x402 tx.
    mapping(bytes32 => mapping(bytes32 => bool)) public settlementSeen;

    // ---------------------------------------------------------------------
    // Registration
    // ---------------------------------------------------------------------

    /// @notice Registers a new signal owned by `msg.sender`.
    /// @param slug  Non-empty, <= 64 bytes.
    /// @param url   Non-empty HTTPS endpoint.
    /// @param price Per-call price in settlement-token base units. May be zero.
    /// @return signalId Deterministic id for this (author, slug) pair.
    function register(
        string calldata slug,
        string calldata url,
        uint256 price
    ) external returns (bytes32 signalId) {
        uint256 slugLen = bytes(slug).length;
        if (slugLen == 0 || slugLen > MAX_SLUG_LEN) revert BadSlug();
        if (bytes(url).length == 0) revert BadUrl();

        signalId = keccak256(abi.encodePacked(msg.sender, slug));
        if (signals[signalId].author != address(0)) revert AlreadyRegistered();

        signals[signalId] = Signal({
            author: msg.sender,
            slug: slug,
            url: url,
            price: price,
            registeredAt: uint64(block.timestamp),
            retired: false,
            callCount: 0,
            cumulativeRevenue: 0
        });

        _signalsByAuthor[msg.sender].push(signalId);
        _allSignals.push(signalId);

        emit SignalRegistered(signalId, msg.sender, slug, url, price);
    }

    /// @notice Updates the serving URL and/or price. Author-only, non-retired.
    function update(bytes32 signalId, string calldata url, uint256 price) external {
        Signal storage s = signals[signalId];
        if (s.author != msg.sender) revert NotAuthor();
        if (s.retired) revert Retired();
        if (bytes(url).length == 0) revert BadUrl();

        s.url = url;
        s.price = price;

        emit SignalUpdated(signalId, url, price);
    }

    /// @notice Retires a signal. Irreversible.
    function retire(bytes32 signalId) external {
        Signal storage s = signals[signalId];
        if (s.author != msg.sender) revert NotAuthor();
        if (s.retired) revert Retired();
        s.retired = true;
        emit SignalRetired(signalId);
    }

    // ---------------------------------------------------------------------
    // Composition
    // ---------------------------------------------------------------------

    /// @notice Declares this composite's upstream dependencies and share split. Author-only.
    /// @dev    Shares are basis points in (0, 10_000]. Slack (10_000 - sum) is the composite
    ///         author's implicit margin, distributed at call time by PaymentSplitter — the
    ///         registry itself does not custody funds.
    function setComposition(
        bytes32 signalId,
        bytes32[] calldata upstream,
        uint16[] calldata shares
    ) external {
        Signal storage s = signals[signalId];
        if (s.author != msg.sender) revert NotAuthor();
        if (upstream.length != shares.length) revert LengthMismatch();
        if (upstream.length == 0) revert EmptyComposition();

        uint256 total;
        for (uint256 i; i < upstream.length; ++i) {
            bytes32 up = upstream[i];
            if (up == signalId) revert SelfReference();
            Signal storage u = signals[up];
            if (u.author == address(0)) revert UpstreamMissing();
            if (u.retired) revert UpstreamRetired();
            total += shares[i];
        }
        if (total == 0 || total > BPS_DENOMINATOR) revert BadShares();

        emit CompositionSet(signalId, upstream, shares);
    }

    // ---------------------------------------------------------------------
    // Call recording
    // ---------------------------------------------------------------------

    /// @notice Records a successful x402 settlement. Author-only. The caller is the signal
    ///         operator; the facilitator tx hash is deduped so a settlement can only be
    ///         counted once per signal.
    function recordCall(
        bytes32 signalId,
        address payer,
        uint256 amount,
        bytes32 settlement
    ) external {
        Signal storage s = signals[signalId];
        if (s.author == address(0)) revert UnknownSignal();
        if (s.author != msg.sender) revert NotAuthor();
        if (payer == address(0)) revert ZeroPayer();
        if (settlementSeen[signalId][settlement]) revert DuplicateSettlement();

        settlementSeen[signalId][settlement] = true;
        unchecked {
            s.callCount += 1;
            s.cumulativeRevenue += amount;
        }

        emit CallRecorded(signalId, payer, amount, settlement);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    /// @notice Total registered signals, including retired.
    function totalSignals() external view returns (uint256) {
        return _allSignals.length;
    }

    /// @notice Count of signals authored by `author`.
    function authorSignalCount(address author) external view returns (uint256) {
        return _signalsByAuthor[author].length;
    }

    /// @notice Paginated read of the global signal list. Off-chain indexers should prefer
    ///         the event stream (`SignalRegistered`) for full history.
    function signalIdAt(uint256 index) external view returns (bytes32) {
        return _allSignals[index];
    }

    /// @notice Paginated read of an author's signal list.
    function authorSignalAt(address author, uint256 index) external view returns (bytes32) {
        return _signalsByAuthor[author][index];
    }

    /// @notice Deterministic id for (author, slug).
    function signalIdOf(address author, string calldata slug) external pure returns (bytes32) {
        return keccak256(abi.encodePacked(author, slug));
    }
}
