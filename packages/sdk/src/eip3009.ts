import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  recoverTypedDataAddress,
  type Account,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import {
  xLayer,
  xLayerTestnet,
  resolveToken,
  type SettlementToken,
  type SettlementTokenKey,
} from "./chains.js";
import type { EIP3009Authorization } from "./types.js";

/**
 * EIP-712 primaryType struct used by every EIP-3009 compliant token's
 * `transferWithAuthorization` method.
 */
export const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

export const TRANSFER_WITH_AUTHORIZATION_ABI = parseAbi([
  "function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s) external",
  "function authorizationState(address authorizer, bytes32 nonce) external view returns (bool)",
]);

/**
 * Builds the EIP-712 domain for an EIP-3009 settlement token. Accepts either a
 * known mainnet key ("USDT0", "USDC") or a runtime descriptor for testnet /
 * self-deployed tokens.
 */
export function buildDomain(
  token: SettlementTokenKey | SettlementToken,
  chainId: number
) {
  const t = resolveToken(token);
  return {
    name: t.eip712Name,
    version: t.eip712Version,
    chainId,
    verifyingContract: t.address,
  } as const;
}

/**
 * Recovers the signer from an EIP-3009 `TransferWithAuthorization` signature and
 * verifies it matches `auth.from`. Does not validate on-chain state — that's the
 * settler's job.
 */
export async function verifyAuthorizationSignature(
  auth: EIP3009Authorization,
  signature: Hex,
  token: SettlementTokenKey | SettlementToken,
  chainId: number
): Promise<Address> {
  const domain = buildDomain(token, chainId);
  const recovered = await recoverTypedDataAddress({
    domain,
    types: TRANSFER_WITH_AUTHORIZATION_TYPES,
    primaryType: "TransferWithAuthorization",
    message: {
      from: auth.from,
      to: auth.to,
      value: BigInt(auth.value),
      validAfter: BigInt(auth.validAfter),
      validBefore: BigInt(auth.validBefore),
      nonce: auth.nonce,
    },
    signature,
  });
  if (recovered.toLowerCase() !== auth.from.toLowerCase()) {
    throw new Error("signature does not match authorization.from");
  }
  return recovered;
}

export function splitSignature(signature: Hex): { v: number; r: Hex; s: Hex } {
  const sig = signature.startsWith("0x") ? signature.slice(2) : signature;
  if (sig.length !== 130) throw new Error("invalid signature length");
  const r = `0x${sig.slice(0, 64)}` as Hex;
  const s = `0x${sig.slice(64, 128)}` as Hex;
  const v = parseInt(sig.slice(128, 130), 16);
  return { v, r, s };
}

/**
 * Calls `transferWithAuthorization` on the token contract, settling the buyer's
 * signed authorization on-chain. The caller (the signal server's wallet) pays gas.
 */
export async function settleAuthorization(
  walletClient: WalletClient,
  auth: EIP3009Authorization,
  signature: Hex,
  token: SettlementTokenKey | SettlementToken,
  chain: Chain
): Promise<Hex> {
  const t = resolveToken(token);
  const { v, r, s } = splitSignature(signature);
  const account = walletClient.account;
  if (!account) throw new Error("walletClient has no account");

  return walletClient.writeContract({
    address: t.address,
    abi: TRANSFER_WITH_AUTHORIZATION_ABI,
    functionName: "transferWithAuthorization",
    args: [
      auth.from,
      auth.to,
      BigInt(auth.value),
      BigInt(auth.validAfter),
      BigInt(auth.validBefore),
      auth.nonce,
      v,
      r,
      s,
    ],
    account,
    chain,
  });
}

export async function isAuthorizationUsed(
  publicClient: PublicClient,
  token: SettlementTokenKey | SettlementToken,
  authorizer: Address,
  nonce: Hex
): Promise<boolean> {
  const t = resolveToken(token);
  return publicClient.readContract({
    address: t.address,
    abi: TRANSFER_WITH_AUTHORIZATION_ABI,
    functionName: "authorizationState",
    args: [authorizer, nonce],
  });
}

export function xLayerPublicClient(rpcUrl?: string): PublicClient {
  return createPublicClient({ chain: xLayer, transport: http(rpcUrl) }) as unknown as PublicClient;
}

export function xLayerWalletClient(account: Account, rpcUrl?: string): WalletClient {
  return createWalletClient({ account, chain: xLayer, transport: http(rpcUrl) });
}

export function xLayerTestnetPublicClient(rpcUrl?: string): PublicClient {
  return createPublicClient({ chain: xLayerTestnet, transport: http(rpcUrl) }) as unknown as PublicClient;
}

export function xLayerTestnetWalletClient(account: Account, rpcUrl?: string): WalletClient {
  return createWalletClient({ account, chain: xLayerTestnet, transport: http(rpcUrl) });
}
