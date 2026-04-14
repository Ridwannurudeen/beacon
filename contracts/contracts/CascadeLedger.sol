// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @title  CascadeLedger
/// @author Beacon
/// @notice On-chain registry accepting EIP-712-signed CascadeReceipts from
///         composite signal servers. Anyone can submit a valid signed receipt;
///         the ledger verifies the signature against the declared composite
///         address and emits a `CascadeSettled` event capturing the full
///         upstream payment graph. Indexers derive cascade state from these
///         events — no heuristic block-window matching, no trust in the
///         composite server beyond its signing key.
/// @dev    Receipts are deduplicated by `receiptId`, which composites compute
///         as keccak256(buyer, buyerSettlementTx). Re-submission of the same
///         receipt is rejected. The ledger itself holds no funds and has no
///         admin surface — it is a purely observational primitive.
contract CascadeLedger is EIP712 {
    string public constant VERSION = "1";

    struct UpstreamPayment {
        string slug;
        address author;
        uint256 amount;
        bytes32 settlementTx;
    }

    struct CascadeReceipt {
        address composite;
        bytes32 receiptId;
        address buyer;
        uint256 buyerAmount;
        address settlementToken;
        bytes32 buyerSettlementTx;
        UpstreamPayment[] upstreams;
        uint256 timestamp;
        uint256 chainId;
    }

    // keccak256("UpstreamPayment(string slug,address author,uint256 amount,bytes32 settlementTx)")
    bytes32 public constant UPSTREAM_PAYMENT_TYPEHASH =
        keccak256("UpstreamPayment(string slug,address author,uint256 amount,bytes32 settlementTx)");

    // keccak256("CascadeReceipt(address composite,bytes32 receiptId,address buyer,uint256 buyerAmount,address settlementToken,bytes32 buyerSettlementTx,UpstreamPayment[] upstreams,uint256 timestamp,uint256 chainId)UpstreamPayment(string slug,address author,uint256 amount,bytes32 settlementTx)")
    bytes32 public constant CASCADE_RECEIPT_TYPEHASH =
        keccak256(
            "CascadeReceipt(address composite,bytes32 receiptId,address buyer,uint256 buyerAmount,address settlementToken,bytes32 buyerSettlementTx,UpstreamPayment[] upstreams,uint256 timestamp,uint256 chainId)UpstreamPayment(string slug,address author,uint256 amount,bytes32 settlementTx)"
        );

    error AlreadySubmitted();
    error BadSignature();
    error ChainIdMismatch();
    error ReceiptIdMismatch();

    /// @notice Emitted once per successfully-verified receipt.
    event CascadeSettled(
        bytes32 indexed receiptId,
        address indexed composite,
        address indexed buyer,
        uint256 buyerAmount,
        address settlementToken,
        bytes32 buyerSettlementTx,
        uint256 timestamp
    );

    /// @notice Emitted once per upstream payment within a receipt. Parallel
    ///         array; `index` is stable and reflects the composite's payment
    ///         ordering.
    event UpstreamPaid(
        bytes32 indexed receiptId,
        uint256 indexed index,
        string slug,
        address indexed author,
        uint256 amount,
        bytes32 settlementTx
    );

    /// @notice Dedup map — `true` once a receipt has been recorded.
    mapping(bytes32 => bool) public submitted;

    constructor() EIP712("Beacon CascadeReceipt", VERSION) {}

    /// @notice Submits a signed CascadeReceipt. The ledger verifies the
    ///         EIP-712 signature recovers to `receipt.composite`, checks the
    ///         chainId binding, confirms the deterministic receiptId, and
    ///         emits events. Reverts if the receipt has been submitted before.
    function submit(CascadeReceipt calldata receipt, bytes calldata signature) external {
        if (submitted[receipt.receiptId]) revert AlreadySubmitted();
        if (receipt.chainId != block.chainid) revert ChainIdMismatch();
        bytes32 expectedId = keccak256(
            abi.encodePacked(receipt.buyer, receipt.buyerSettlementTx)
        );
        if (receipt.receiptId != expectedId) revert ReceiptIdMismatch();

        bytes32 digest = _hashTypedDataV4(_hashReceipt(receipt));
        address signer = ECDSA.recover(digest, signature);
        if (signer != receipt.composite) revert BadSignature();

        submitted[receipt.receiptId] = true;

        emit CascadeSettled(
            receipt.receiptId,
            receipt.composite,
            receipt.buyer,
            receipt.buyerAmount,
            receipt.settlementToken,
            receipt.buyerSettlementTx,
            receipt.timestamp
        );

        uint256 n = receipt.upstreams.length;
        for (uint256 i; i < n; ++i) {
            UpstreamPayment calldata up = receipt.upstreams[i];
            emit UpstreamPaid(
                receipt.receiptId,
                i,
                up.slug,
                up.author,
                up.amount,
                up.settlementTx
            );
        }
    }

    /// @notice EIP-712 digest for an off-chain consumer that wants to verify
    ///         without submitting. Same hash the contract checks internally.
    function hashReceipt(CascadeReceipt calldata receipt) external view returns (bytes32) {
        return _hashTypedDataV4(_hashReceipt(receipt));
    }

    function _hashReceipt(CascadeReceipt calldata r) internal pure returns (bytes32) {
        bytes32[] memory upstreamHashes = new bytes32[](r.upstreams.length);
        for (uint256 i; i < r.upstreams.length; ++i) {
            UpstreamPayment calldata up = r.upstreams[i];
            upstreamHashes[i] = keccak256(
                abi.encode(
                    UPSTREAM_PAYMENT_TYPEHASH,
                    keccak256(bytes(up.slug)),
                    up.author,
                    up.amount,
                    up.settlementTx
                )
            );
        }
        return keccak256(
            abi.encode(
                CASCADE_RECEIPT_TYPEHASH,
                r.composite,
                r.receiptId,
                r.buyer,
                r.buyerAmount,
                r.settlementToken,
                r.buyerSettlementTx,
                keccak256(abi.encodePacked(upstreamHashes)),
                r.timestamp,
                r.chainId
            )
        );
    }
}
