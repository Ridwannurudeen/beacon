/**
 * @beacon/okx-client — thin wrapper around OKX Onchain OS + Uniswap AI skills
 * for X Layer mainnet (chainId 196). Signs every request with the HMAC-SHA256
 * scheme required by OKX's DEX API.
 *
 * Mirrored from PreflightX's production-hardened client.
 */
import axios, { type AxiosInstance, type InternalAxiosRequestConfig } from "axios";
import { createHmac } from "node:crypto";

export const X_LAYER_CHAIN_ID = 196;
export const X_LAYER_MAINNET_RPC = "https://rpc.xlayer.tech";

export interface OnchainosClientOptions {
  apiKey: string;
  secretKey: string;
  passphrase: string;
  baseUrl?: string;
}

function signRequest(secretKey: string, timestamp: string, method: string, requestPath: string, body: string): string {
  const preHash = timestamp + method.toUpperCase() + requestPath + body;
  return createHmac("sha256", secretKey).update(preHash).digest("base64");
}

export interface QuoteResult {
  fromAmount: string;
  toAmount: string;
  estimatedSlippageBps: number;
  routerAddress: string;
  callData: string;
  value: string;
  liquiditySources: string[];
  quotedAt: number;
}
export interface TokenInfo {
  address: string;
  symbol: string;
  decimals: number;
  createdAt?: number;
  verified?: boolean;
  topHolderConcentrationPct?: number;
}
export interface PortfolioSnapshot {
  totalValueUsd: number;
  balances: Array<{ token: string; amountBaseUnits: string; valueUsd: number }>;
}
export interface SimResult {
  success: boolean;
  gasUsed: string;
  revertReason?: string;
}

export class OnchainosClient {
  private readonly http: AxiosInstance;

  constructor(opts: OnchainosClientOptions) {
    const baseURL = opts.baseUrl ?? "https://web3.okx.com";
    this.http = axios.create({ baseURL, timeout: 12_000 });
    this.http.interceptors.request.use((config: InternalAxiosRequestConfig) => {
      const timestamp = new Date().toISOString();
      const method = (config.method ?? "get").toUpperCase();
      const url = new URL(config.url ?? "", baseURL);
      for (const [k, v] of Object.entries(config.params ?? {})) {
        url.searchParams.set(k, String(v));
      }
      const requestPath = url.pathname + (url.search || "");
      const body = config.data ? JSON.stringify(config.data) : "";
      const sign = signRequest(opts.secretKey, timestamp, method, requestPath, body);
      config.headers.set("OK-ACCESS-KEY", opts.apiKey);
      config.headers.set("OK-ACCESS-SIGN", sign);
      config.headers.set("OK-ACCESS-TIMESTAMP", timestamp);
      config.headers.set("OK-ACCESS-PASSPHRASE", opts.passphrase);
      config.headers.set("Content-Type", "application/json");
      return config;
    });
  }

  /** OKX DEX aggregator quote — "Swap" skill. */
  async getQuote(p: { fromToken: string; toToken: string; amount: string }): Promise<QuoteResult> {
    const { data } = await this.http.get("/api/v5/dex/aggregator/quote", {
      params: { chainId: X_LAYER_CHAIN_ID, fromTokenAddress: p.fromToken, toTokenAddress: p.toToken, amount: p.amount },
    });
    const q = data?.data?.[0];
    if (!q) throw new Error("OnchainOS quote: empty response");
    return {
      fromAmount: q.fromTokenAmount,
      toAmount: q.toTokenAmount,
      estimatedSlippageBps: Number(q.estimatedSlippageBps ?? 0),
      routerAddress: q.routerAddress ?? q.to,
      callData: q.data ?? q.callData ?? "0x",
      value: q.value ?? "0",
      liquiditySources: q.dexRouterList?.map((d: { dexName: string }) => d.dexName) ?? [],
      quotedAt: Date.now(),
    };
  }

  /** Market Data skill — token info + holder concentration. */
  async getTokenInfo(tokenAddress: string): Promise<TokenInfo> {
    const { data } = await this.http.get("/api/v5/dex/market/token-info", {
      params: { chainId: X_LAYER_CHAIN_ID, tokenAddress },
    });
    const t = data?.data?.[0];
    if (!t) throw new Error(`OnchainOS token-info: not found ${tokenAddress}`);
    return {
      address: tokenAddress,
      symbol: t.symbol,
      decimals: Number(t.decimals),
      createdAt: t.createdAt ? Number(t.createdAt) : undefined,
      verified: Boolean(t.verified),
      topHolderConcentrationPct: t.topHolderConcentrationPct ? Number(t.topHolderConcentrationPct) : undefined,
    };
  }

  /** Market Data skill — USD spot price. */
  async getMarketPriceUsd(tokenAddress: string): Promise<{ price: number; updatedAt: number }> {
    const { data } = await this.http.get("/api/v5/dex/market/price", {
      params: { chainId: X_LAYER_CHAIN_ID, tokenAddress },
    });
    const p = data?.data?.[0];
    if (!p) throw new Error(`OnchainOS price: not found ${tokenAddress}`);
    return { price: Number(p.price), updatedAt: Number(p.timestamp ?? Date.now()) };
  }

  /** Market Data skill — OHLC candles. */
  async getRecentCandles(
    tokenAddress: string,
    bar: "1m" | "5m" | "15m" | "1H" = "15m",
    limit = 4,
  ): Promise<Array<{ open: number; close: number; ts: number }>> {
    const { data } = await this.http.get("/api/v5/dex/market/candles", {
      params: { chainId: X_LAYER_CHAIN_ID, tokenAddress, bar, limit },
    });
    const rows = data?.data ?? [];
    return rows.map((r: { ts?: string; o?: string; c?: string } | string[]) => {
      if (Array.isArray(r)) return { ts: Number(r[0]), open: Number(r[1]), close: Number(r[4]) };
      return { ts: Number(r.ts), open: Number(r.o), close: Number(r.c) };
    });
  }

  /** Onchain Gateway skill — tx simulation. */
  async simulateTx(p: { from: string; to: string; data: string; value: string }): Promise<SimResult> {
    const { data } = await this.http.post("/api/v5/dex/aggregator/onchain-gateway/simulate-tx", {
      chainId: X_LAYER_CHAIN_ID,
      ...p,
    });
    const s = data?.data?.[0] ?? data?.data;
    if (!s) throw new Error("OnchainOS simulate-tx: empty response");
    return { success: Boolean(s.success), gasUsed: String(s.gasUsed ?? "0"), revertReason: s.revertReason };
  }

  /** Onchain Gateway skill — current gas price. */
  async getGasPriceWei(): Promise<string> {
    const { data } = await this.http.get("/api/v5/dex/aggregator/onchain-gateway/gas-price", {
      params: { chainId: X_LAYER_CHAIN_ID },
    });
    const p = data?.data?.[0]?.normal ?? data?.data?.normal ?? data?.data;
    if (p == null) throw new Error("OnchainOS gas-price: empty response");
    return String(p);
  }

  /** Wallet skill — portfolio snapshot for an address. */
  async getPortfolio(address: string): Promise<PortfolioSnapshot> {
    const { data } = await this.http.get("/api/v5/wallet/asset/total-value", {
      params: { address, chains: X_LAYER_CHAIN_ID },
    });
    const totalValueUsd = Number(data?.data?.[0]?.totalValue ?? 0);
    const { data: bal } = await this.http.get("/api/v5/wallet/asset/all-token-balances", {
      params: { address, chains: X_LAYER_CHAIN_ID },
    });
    const balances = (bal?.data?.[0]?.tokenAssets ?? []).map(
      (b: { tokenAddress: string; balance: string; tokenPrice: string }) => ({
        token: b.tokenAddress,
        amountBaseUnits: b.balance,
        valueUsd: Number(b.balance) * Number(b.tokenPrice ?? 0),
      }),
    );
    return { totalValueUsd, balances };
  }
}

/** Construct from env. */
export function fromEnv(env: NodeJS.ProcessEnv = process.env): OnchainosClient {
  const apiKey = env.ONCHAINOS_API_KEY;
  const secretKey = env.ONCHAINOS_SECRET_KEY;
  const passphrase = env.ONCHAINOS_PASSPHRASE;
  if (!apiKey || !secretKey || !passphrase) {
    throw new Error("Missing ONCHAINOS_API_KEY / ONCHAINOS_SECRET_KEY / ONCHAINOS_PASSPHRASE in env");
  }
  return new OnchainosClient({ apiKey, secretKey, passphrase, baseUrl: env.OKX_BASE_URL });
}
