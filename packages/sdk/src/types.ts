import type { Address, Hex } from "viem";
import type { SettlementTokenKey } from "./chains.js";

/**
 * EIP-3009 `TransferWithAuthorization` struct. The buyer's Agentic Wallet (or EOA)
 * signs this via EIP-712 typed data; the signature plus the struct constitute the
 * x402 payment payload we carry in the `X-Payment` header.
 */
export interface EIP3009Authorization {
  from: Address;
  to: Address;
  value: string; // decimal string, base units
  validAfter: string; // unix seconds as decimal string
  validBefore: string; // unix seconds as decimal string
  nonce: Hex; // 32-byte random
}

/** The base64 JSON payload a buyer embeds in the `X-Payment` header. */
export interface X402PaymentPayload {
  x402Version: 2;
  scheme: "exact";
  network: string; // e.g. "evm:196"
  payload: {
    signature: Hex;
    authorization: EIP3009Authorization;
  };
}

/** A single payment option advertised in the 402 response's `accepts` array. */
export interface PaymentOption {
  scheme: "exact";
  network: string;
  payTo: Address;
  asset: Address;
  maxAmountRequired: string;
  maxTimeoutSeconds: number;
  resource: string;
  description: string;
  mimeType: string;
  extra: {
    name: string; // EIP-712 domain name
    version: string; // EIP-712 domain version
  };
}

/** The body of a 402 Payment Required response. */
export interface PaymentRequired {
  x402Version: 2;
  error: string;
  accepts: PaymentOption[];
}

/**
 * Response body returned in the `X-Payment-Response` header on successful settlement.
 * Base64-encoded JSON. Clients decode it to surface the settlement tx hash.
 */
export interface X402PaymentResponse {
  success: boolean;
  transaction: Hex;
  network: string;
  payer: Address;
}

/** Metadata written into the on-chain SignalRegistry when publishing. */
export interface SignalMetadata {
  slug: string;
  description: string;
  price: bigint;
  payTo: Address;
  token: SettlementTokenKey;
}

/** Declared upstream dependency of a composite signal. */
export interface UpstreamDependency {
  /** Public URL of the upstream signal. */
  url: string;
  /** Per-call price in settlement-token base units. */
  price: bigint;
  /** Share in basis points (0..10000). */
  shareBps: number;
  /** Author address — where the upstream's payment should be directed. */
  payTo: Address;
}

/**
 * Shape of a composite's request to its upstreams. The composite server forwards
 * its buyer's x402 payment outward via `wrapFetchWithPayment`-style clients, not
 * by re-signing — that would require a composite wallet. Instead, the composite
 * takes the buyer's payment on its own endpoint, then pays upstreams from its own
 * wallet (via PaymentSplitter), and returns the aggregated result.
 */
export interface CompositeFetchResult {
  upstreamUrl: string;
  data: unknown;
  paymentTx?: Hex;
}
