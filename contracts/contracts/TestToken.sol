// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @title  TestToken — EIP-3009 settlement token for Beacon on X Layer testnet
/// @notice Mirrors the semantics of USDT0/USDC on mainnet (6 decimals, name, version)
///         so the Signal SDK's EIP-712 domain resolves identically. Exposes a public
///         `mint()` so anyone can fund themselves via the X Layer testnet faucet +
///         this contract.
/// @dev    Implements the subset of EIP-3009 that Beacon uses:
///           - transferWithAuthorization(from, to, value, validAfter, validBefore, nonce, v, r, s)
///           - authorizationState(authorizer, nonce) view
///         `cancelAuthorization` and `receiveWithAuthorization` are omitted; Beacon's
///         facilitator path only needs the first.
contract TestToken is ERC20, EIP712 {
    // keccak256("TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)")
    bytes32 public constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH =
        0x7c7c6cdb67a18743f49ec6fa9b35f50d52ed05cbed4cc592e13b44501c1a2267;

    error AuthorizationExpired();
    error AuthorizationNotYetValid();
    error AuthorizationUsedOrCanceled();
    error InvalidSignature();

    event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce);

    mapping(address => mapping(bytes32 => bool)) private _authorizationStates;

    constructor(
        string memory name_,
        string memory symbol_,
        string memory version_
    ) ERC20(name_, symbol_) EIP712(name_, version_) {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Open mint for testnet only. Anyone can mint up to `amount` to any address.
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// @notice Returns whether `nonce` for `authorizer` has been used (or canceled).
    function authorizationState(address authorizer, bytes32 nonce) external view returns (bool) {
        return _authorizationStates[authorizer][nonce];
    }

    /// @notice Executes a transfer with a signed authorization. EIP-3009.
    /// @dev    Anyone may submit the signed authorization (the facilitator role).
    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        if (block.timestamp <= validAfter) revert AuthorizationNotYetValid();
        if (block.timestamp >= validBefore) revert AuthorizationExpired();
        if (_authorizationStates[from][nonce]) revert AuthorizationUsedOrCanceled();

        bytes32 structHash = keccak256(
            abi.encode(
                TRANSFER_WITH_AUTHORIZATION_TYPEHASH,
                from,
                to,
                value,
                validAfter,
                validBefore,
                nonce
            )
        );
        bytes32 digest = _hashTypedDataV4(structHash);
        address signer = ECDSA.recover(digest, v, r, s);
        if (signer != from) revert InvalidSignature();

        _authorizationStates[from][nonce] = true;
        emit AuthorizationUsed(from, nonce);

        _transfer(from, to, value);
    }
}
