import { defineChain } from "viem";

/**
 * X Layer mainnet (chainId 196). Production settlement chain.
 */
export const xLayer = defineChain({
  id: 196,
  name: "X Layer",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.xlayer.tech"] },
    public: { http: ["https://rpc.xlayer.tech", "https://xlayerrpc.okx.com"] },
  },
  blockExplorers: {
    default: { name: "OKLink", url: "https://www.oklink.com/xlayer" },
  },
  testnet: false,
});

/**
 * X Layer testnet (chainId 1952). Beacon's default dev/demo chain. Beacon deploys its
 * own EIP-3009 settlement token (TestToken) here since USDT0 only exists on mainnet.
 */
export const xLayerTestnet = defineChain({
  id: 1952,
  name: "X Layer Testnet",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://testrpc.xlayer.tech"] },
    public: { http: ["https://testrpc.xlayer.tech", "https://xlayertestrpc.okx.com"] },
  },
  blockExplorers: {
    default: { name: "OKLink Testnet", url: "https://www.oklink.com/xlayer-test" },
  },
  testnet: true,
});

/**
 * A settlement token descriptor. The three EIP-712 fields (`eip712Name`,
 * `eip712Version`, address) plus the chainId form the EIP-712 domain that
 * secures every x402 `transferWithAuthorization` signature.
 */
export interface SettlementToken {
  address: `0x${string}`;
  symbol: string;
  decimals: number;
  eip712Name: string;
  eip712Version: string;
}

/** Canonical tokens on X Layer mainnet. Only these are gas-subsidized via x402. */
export const X_LAYER_TOKENS: Record<"USDT0" | "USDC", SettlementToken> = {
  USDT0: {
    address: "0x779Ded0c9e1022225f8E0630b35a9b54bE713736",
    symbol: "USDT0",
    decimals: 6,
    eip712Name: "Tether USD 0",
    eip712Version: "1",
  },
  USDC: {
    address: "0x74b7f16337b8972027f6196a17a631ac6de26d22",
    symbol: "USDC",
    decimals: 6,
    eip712Name: "USD Coin",
    eip712Version: "2",
  },
};

export type SettlementTokenKey = keyof typeof X_LAYER_TOKENS;

/**
 * x402 network strings. Matches the `${string}:${string}` template the v2 `@x402/core`
 * contract uses — X Layer is not in the v1 Coinbase SDK's closed enum, so we emit the
 * CAIP-style value directly.
 */
export const X_LAYER_NETWORK = "evm:196" as const;
export const X_LAYER_TESTNET_NETWORK = "evm:1952" as const;

/**
 * Resolves a SettlementToken from either a known key (mainnet USDT0/USDC) or a runtime
 * descriptor. Testnet deployments pass the full descriptor since bUSD (Beacon's
 * testnet TestToken) has a per-deployment address.
 */
export function resolveToken(
  input: SettlementTokenKey | SettlementToken
): SettlementToken {
  if (typeof input === "string") return X_LAYER_TOKENS[input];
  return input;
}
