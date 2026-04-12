import type { Address, Hex, WalletClient } from "viem";
import {
  X_LAYER_NETWORK,
  X_LAYER_TESTNET_NETWORK,
  X_LAYER_TOKENS,
  resolveToken,
  type SettlementToken,
  type SettlementTokenKey,
} from "./chains.js";
import { TRANSFER_WITH_AUTHORIZATION_TYPES, buildDomain } from "./eip3009.js";
import type {
  EIP3009Authorization,
  PaymentOption,
  PaymentRequired,
  X402PaymentPayload,
  X402PaymentResponse,
} from "./types.js";

function randomNonce(): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return ("0x" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")) as Hex;
}

/**
 * Signs an EIP-3009 authorization against a settlement token's EIP-712 domain.
 * Token can be a known mainnet key or a runtime descriptor (for testnet bUSD).
 */
export async function signX402Payment(
  walletClient: WalletClient,
  opts: {
    token: SettlementTokenKey | SettlementToken;
    payTo: Address;
    amount: bigint;
    chainId?: number;
    network?: string;
    windowSeconds?: number;
  }
): Promise<X402PaymentPayload> {
  const account = walletClient.account;
  if (!account) throw new Error("walletClient has no account");

  const chainId = opts.chainId ?? 196;
  const network =
    opts.network ?? (chainId === 195 ? X_LAYER_TESTNET_NETWORK : X_LAYER_NETWORK);
  const windowSeconds = opts.windowSeconds ?? 60;
  const now = Math.floor(Date.now() / 1000);

  const auth: EIP3009Authorization = {
    from: account.address,
    to: opts.payTo,
    value: opts.amount.toString(),
    validAfter: (now - 5).toString(),
    validBefore: (now + windowSeconds).toString(),
    nonce: randomNonce(),
  };

  const domain = buildDomain(opts.token, chainId);
  const signature = await walletClient.signTypedData({
    account,
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
  });

  return {
    x402Version: 2,
    scheme: "exact",
    network,
    payload: { signature, authorization: auth },
  };
}

export function encodePaymentHeader(payload: X402PaymentPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}

export function decodePaymentResponseHeader(header: string): X402PaymentResponse {
  return JSON.parse(Buffer.from(header, "base64").toString("utf-8")) as X402PaymentResponse;
}

/**
 * Fetch wrapper that auto-pays 402 responses. First call unpaid; on 402, parses
 * `PaymentRequired`, signs an EIP-3009 authorization for the first acceptable
 * option (or a caller-selected one), retries with `X-Payment` header set.
 *
 * For testnet flows, the caller passes a `tokenResolver` so the client can map
 * the advertised asset address to the correct EIP-712 domain metadata — mainnet
 * metadata is hardcoded; testnet metadata comes from the signal's `/meta`
 * endpoint or a deployment manifest.
 */
export async function fetchWithPayment(
  url: string,
  walletClient: WalletClient,
  init?: RequestInit,
  opts?: {
    acceptor?: (options: PaymentOption[]) => PaymentOption;
    /**
     * Resolves a payment option's asset address → the SettlementToken descriptor
     * used for EIP-712 signing. Defaults to mainnet USDT0/USDC lookup.
     */
    tokenResolver?: (option: PaymentOption) => SettlementToken;
    chainId?: number;
  }
): Promise<Response> {
  const first = await fetch(url, init);
  if (first.status !== 402) return first;

  const body = (await first.clone().json()) as PaymentRequired;
  if (!body.accepts || body.accepts.length === 0) {
    throw new Error("402 response without accepts[]");
  }
  const pick = opts?.acceptor ? opts.acceptor(body.accepts) : body.accepts[0];
  if (!pick) throw new Error("no acceptable payment option");

  const token = opts?.tokenResolver
    ? opts.tokenResolver(pick)
    : defaultTokenResolver(pick);

  const chainId = opts?.chainId ?? chainIdFromNetwork(pick.network);

  const payload = await signX402Payment(walletClient, {
    token,
    payTo: pick.payTo,
    amount: BigInt(pick.maxAmountRequired),
    network: pick.network,
    chainId,
    windowSeconds: pick.maxTimeoutSeconds,
  });

  const headers = new Headers(init?.headers);
  headers.set("X-Payment", encodePaymentHeader(payload));
  return fetch(url, { ...init, headers });
}

/**
 * Default resolver: tries mainnet USDT0/USDC, else builds a descriptor from the
 * `extra.name` and `extra.version` the signal advertised in its 402 response.
 */
function defaultTokenResolver(option: PaymentOption): SettlementToken {
  const lower = option.asset.toLowerCase();
  for (const meta of Object.values(X_LAYER_TOKENS)) {
    if (meta.address.toLowerCase() === lower) return meta;
  }
  return {
    address: option.asset,
    symbol: option.extra.name,
    decimals: 6,
    eip712Name: option.extra.name,
    eip712Version: option.extra.version,
  };
}

function chainIdFromNetwork(network: string): number {
  const m = network.match(/^evm:(\d+)$/);
  if (!m || !m[1]) return 196;
  return Number(m[1]);
}
