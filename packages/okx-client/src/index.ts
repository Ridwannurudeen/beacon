/**
 * @beacon/okx-client — thin wrapper around OKX Onchain OS DEX API V6 for
 * X Layer mainnet (chainId 196, chainIndex 196). All calls are HMAC-SHA256
 * signed per the OKX API spec.
 *
 * V6 quirks (vs the older V5 docs floating around):
 *   - URL params use `chainIndex`, not `chainId`
 *   - price-info / candles have different response shapes
 *   - Wallet endpoints still live on V5 at /api/v5/wallet/... (by-address form)
 */
import axios, { type AxiosInstance, type InternalAxiosRequestConfig } from "axios";
import { createHmac } from "node:crypto";

export const X_LAYER_CHAIN_ID = 196;
export const X_LAYER_CHAIN_INDEX = "196";
export const X_LAYER_MAINNET_RPC = "https://rpc.xlayer.tech";

export interface OnchainosClientOptions {
  apiKey: string;
  secretKey: string;
  passphrase: string;
  baseUrl?: string;
}

function signRequest(secretKey: string, timestamp: string, method: string, requestPath: string, body: string): string {
  const pre = timestamp + method.toUpperCase() + requestPath + body;
  return createHmac("sha256", secretKey).update(pre).digest("base64");
}

export interface SupportedChain {
  chainId: number;
  chainIndex: number;
  chainName: string;
  dexTokenApproveAddress: string;
}
export interface TokenMeta {
  tokenSymbol: string;
  tokenContractAddress: string;
  decimals: string;
  tokenName?: string;
  tokenLogoUrl?: string;
}
export interface QuoteResult {
  chainIndex: string;
  fromTokenAmount: string;
  toTokenAmount: string;
  router: string;
  estimatedSlippageBps: number;
  dexSources: Array<{ name: string; percent: string }>;
  fromToken?: { tokenSymbol: string; tokenUnitPrice: string; tokenContractAddress: string };
  toToken?: { tokenSymbol: string; tokenUnitPrice: string; tokenContractAddress: string };
  quotedAt: number;
}
export interface PriceInfo {
  price: number;
  marketCap: number;
  liquidity: number;
  priceChange24h: number;
  priceChange1h: number;
  updatedAt: number;
}
export interface Candle {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volumeCoin: number;
  volumeUsd: number;
}
export interface PortfolioSnapshot {
  totalValueUsd: number;
  balances: Array<{ token: string; symbol: string; amountBaseUnits: string; valueUsd: number }>;
}

export class OnchainosClient {
  private readonly http: AxiosInstance;

  constructor(opts: OnchainosClientOptions) {
    const baseURL = opts.baseUrl ?? "https://web3.okx.com";
    this.http = axios.create({ baseURL, timeout: 15_000 });
    this.http.interceptors.request.use((config: InternalAxiosRequestConfig) => {
      const timestamp = new Date().toISOString();
      const method = (config.method ?? "get").toUpperCase();
      const url = new URL(config.url ?? "", baseURL);
      for (const [k, v] of Object.entries(config.params ?? {})) {
        url.searchParams.set(k, String(v));
      }
      const requestPath = url.pathname + (url.search || "");
      const body = config.data ? JSON.stringify(config.data) : "";
      const sig = signRequest(opts.secretKey, timestamp, method, requestPath, body);
      config.headers.set("OK-ACCESS-KEY", opts.apiKey);
      config.headers.set("OK-ACCESS-SIGN", sig);
      config.headers.set("OK-ACCESS-TIMESTAMP", timestamp);
      config.headers.set("OK-ACCESS-PASSPHRASE", opts.passphrase);
      config.headers.set("Content-Type", "application/json");
      return config;
    });
  }

  /** V6 supported chains — returns every chain OKX aggregator serves. */
  async getSupportedChains(): Promise<SupportedChain[]> {
    const { data } = await this.http.get("/api/v6/dex/aggregator/supported/chain");
    if (data?.code !== "0" && data?.code !== 0) throw new Error(`OKX supported/chain: ${data?.msg}`);
    return data.data as SupportedChain[];
  }

  /** V6 all tokens on a chain. Returns e.g. USDT/USDC/OKB/WOKB for X Layer. */
  async getTokens(chainIndex: string = X_LAYER_CHAIN_INDEX): Promise<TokenMeta[]> {
    const { data } = await this.http.get("/api/v6/dex/aggregator/all-tokens", {
      params: { chainIndex },
    });
    if (data?.code !== "0" && data?.code !== 0) throw new Error(`OKX all-tokens: ${data?.msg}`);
    return data.data as TokenMeta[];
  }

  /** V6 DEX aggregator quote — "Swap" skill. */
  async getQuote(p: {
    fromToken: string;
    toToken: string;
    amount: string;
    chainIndex?: string;
  }): Promise<QuoteResult> {
    const { data } = await this.http.get("/api/v6/dex/aggregator/quote", {
      params: {
        chainIndex: p.chainIndex ?? X_LAYER_CHAIN_INDEX,
        fromTokenAddress: p.fromToken,
        toTokenAddress: p.toToken,
        amount: p.amount,
      },
    });
    if (data?.code !== "0" && data?.code !== 0) throw new Error(`OKX quote: ${data?.msg}`);
    const q = data.data?.[0];
    if (!q) throw new Error("OKX quote: empty response");
    return {
      chainIndex: q.chainIndex,
      fromTokenAmount: q.fromTokenAmount,
      toTokenAmount: q.toTokenAmount,
      router: q.router,
      estimatedSlippageBps: Number(q.estimatedSlippageBps ?? 0),
      dexSources: (q.dexRouterList ?? []).map((d: { dexProtocol?: { dexName?: string; percent?: string } }) => ({
        name: d.dexProtocol?.dexName ?? "",
        percent: d.dexProtocol?.percent ?? "0",
      })),
      fromToken: q.fromToken,
      toToken: q.toToken,
      quotedAt: Date.now(),
    };
  }

  /** V6 market price-info (POST with array body). */
  async getPriceInfo(tokenAddress: string, chainIndex: string = X_LAYER_CHAIN_INDEX): Promise<PriceInfo> {
    const { data } = await this.http.post("/api/v6/dex/market/price-info", [
      { chainIndex, tokenContractAddress: tokenAddress },
    ]);
    if (data?.code !== "0" && data?.code !== 0) throw new Error(`OKX price-info: ${data?.msg}`);
    const p = data.data?.[0];
    if (!p) throw new Error(`OKX price-info: not found ${tokenAddress}`);
    return {
      price: Number(p.price),
      marketCap: Number(p.marketCap ?? 0),
      liquidity: Number(p.liquidity ?? 0),
      priceChange24h: Number(p.priceChange24H ?? 0),
      priceChange1h: Number(p.priceChange1H ?? 0),
      updatedAt: Number(p.time ?? Date.now()),
    };
  }

  /** V6 candles — GET, array-format response [ts, o, h, l, c, volCoin, volUsd, confirm]. */
  async getCandles(
    tokenAddress: string,
    bar: "1m" | "5m" | "15m" | "1H" | "4H" | "1D" = "1H",
    limit = 4,
    chainIndex: string = X_LAYER_CHAIN_INDEX,
  ): Promise<Candle[]> {
    const { data } = await this.http.get("/api/v6/dex/market/candles", {
      params: { chainIndex, tokenContractAddress: tokenAddress, bar, limit: String(limit) },
    });
    if (data?.code !== "0" && data?.code !== 0) throw new Error(`OKX candles: ${data?.msg}`);
    return (data.data ?? []).map((r: string[]) => ({
      ts: Number(r[0]),
      open: Number(r[1]),
      high: Number(r[2]),
      low: Number(r[3]),
      close: Number(r[4]),
      volumeCoin: Number(r[5]),
      volumeUsd: Number(r[6]),
    }));
  }

  /** Wallet skill — portfolio snapshot. Still on V5 at the by-address endpoint. */
  async getPortfolio(address: string, chainIndex: string = X_LAYER_CHAIN_INDEX): Promise<PortfolioSnapshot> {
    const { data } = await this.http.get("/api/v5/wallet/asset/all-token-balances-by-address", {
      params: { address, chains: chainIndex },
    });
    if (data?.code !== "0" && data?.code !== 0) throw new Error(`OKX portfolio: ${data?.msg}`);
    const tokenAssets = data.data?.[0]?.tokenAssets ?? [];
    let total = 0;
    const balances = tokenAssets.map(
      (b: { tokenAddress?: string; address?: string; symbol: string; balance: string; tokenPrice: string; rawBalance: string }) => {
        const valueUsd = Number(b.balance) * Number(b.tokenPrice ?? 0);
        total += valueUsd;
        return {
          token: b.tokenAddress ?? b.address ?? "",
          symbol: b.symbol,
          amountBaseUnits: b.rawBalance ?? b.balance,
          valueUsd,
        };
      },
    );
    return { totalValueUsd: total, balances };
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
