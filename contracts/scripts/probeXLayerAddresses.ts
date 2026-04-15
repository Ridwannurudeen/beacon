/**
 * Queries OKX DEX API for X Layer mainnet router + token addresses.
 * Writes the result to deployments/xlayer.addresses.json so deployAtlasV2Mainnet
 * can read them without hardcoding. All calls are HMAC-signed via the same
 * client used in the signal servers.
 */
import axios, { type InternalAxiosRequestConfig } from "axios";
import { createHmac } from "node:crypto";
import * as fs from "fs";
import * as path from "path";
import "dotenv/config";

const CHAIN_ID = 196;
const BASE_URL = process.env.OKX_BASE_URL ?? "https://web3.okx.com";
const API_KEY = process.env.ONCHAINOS_API_KEY ?? "";
const SECRET_KEY = process.env.ONCHAINOS_SECRET_KEY ?? "";
const PASSPHRASE = process.env.ONCHAINOS_PASSPHRASE ?? "";

if (!API_KEY || !SECRET_KEY || !PASSPHRASE) {
  console.error("Missing ONCHAINOS_API_KEY / ONCHAINOS_SECRET_KEY / ONCHAINOS_PASSPHRASE");
  process.exit(1);
}

function sign(timestamp: string, method: string, requestPath: string, body: string) {
  const pre = timestamp + method.toUpperCase() + requestPath + body;
  return createHmac("sha256", SECRET_KEY).update(pre).digest("base64");
}

const http = axios.create({ baseURL: BASE_URL, timeout: 15_000 });
http.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const timestamp = new Date().toISOString();
  const method = (config.method ?? "get").toUpperCase();
  const url = new URL(config.url ?? "", BASE_URL);
  for (const [k, v] of Object.entries(config.params ?? {})) {
    url.searchParams.set(k, String(v));
  }
  const requestPath = url.pathname + (url.search || "");
  const body = config.data ? JSON.stringify(config.data) : "";
  const s = sign(timestamp, method, requestPath, body);
  config.headers.set("OK-ACCESS-KEY", API_KEY);
  config.headers.set("OK-ACCESS-SIGN", s);
  config.headers.set("OK-ACCESS-TIMESTAMP", timestamp);
  config.headers.set("OK-ACCESS-PASSPHRASE", PASSPHRASE);
  config.headers.set("Content-Type", "application/json");
  return config;
});

async function main() {
  console.log(`Probing OKX DEX API for X Layer mainnet (${CHAIN_ID})...\n`);

  // 1) Supported chains — for the DEX router address + chain metadata
  const chains = await http.get("/api/v5/dex/aggregator/supported/chain", {
    params: { chainId: CHAIN_ID },
  });
  const chain = chains.data?.data?.[0] ?? chains.data?.data;
  console.log("--- supported/chain (raw) ---");
  console.log(JSON.stringify(chain, null, 2));
  console.log("\n");

  // 2) Token list (filter to main candidates: USDT0, WOKB, etc.)
  const tokens = await http.get("/api/v5/dex/aggregator/all-tokens", {
    params: { chainId: CHAIN_ID },
  });
  const list = tokens.data?.data ?? [];
  console.log(`--- tokens (${list.length} total) ---`);
  const interesting = list.filter((t: { tokenSymbol: string }) =>
    /^(USDT0?|USDC|OKB|WOKB|ETH|WETH|DAI)$/i.test(t.tokenSymbol ?? "")
  );
  for (const t of interesting) {
    console.log(`  ${t.tokenSymbol.padEnd(6)} ${t.tokenContractAddress}  (${t.decimal} decimals, ${t.tokenName})`);
  }
  console.log("\n");

  // 3) Sample quote to confirm router works
  // Pick USDT0 → WOKB if both exist
  const usdt0 = interesting.find((t: { tokenSymbol: string }) => /^USDT0?$/i.test(t.tokenSymbol));
  const wokb = interesting.find((t: { tokenSymbol: string }) => /^WOKB|OKB$/i.test(t.tokenSymbol));
  if (usdt0 && wokb) {
    console.log(`--- sample quote (1 USDT0 → WOKB) ---`);
    try {
      const q = await http.get("/api/v5/dex/aggregator/quote", {
        params: {
          chainId: CHAIN_ID,
          fromTokenAddress: usdt0.tokenContractAddress,
          toTokenAddress: wokb.tokenContractAddress,
          amount: String(10n ** BigInt(usdt0.decimal)),
        },
      });
      const r = q.data?.data?.[0];
      if (r) {
        console.log(`  routerAddress: ${r.routerAddress ?? r.to}`);
        console.log(`  expected out:  ${Number(r.toTokenAmount) / 10 ** wokb.decimal} WOKB`);
        console.log(`  dex sources:   ${(r.dexRouterList ?? []).map((d: { dexName: string }) => d.dexName).join(", ")}`);
      }
    } catch (e) {
      console.warn(`  quote failed: ${(e as Error).message}`);
    }
  }

  // Write result
  const out = {
    chainId: CHAIN_ID,
    chainMeta: chain,
    tokens: interesting,
    probedAt: new Date().toISOString(),
  };
  const dir = path.join(process.cwd(), "deployments");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, "xlayer.addresses.json");
  fs.writeFileSync(p, JSON.stringify(out, null, 2));
  console.log(`\n✓ written ${p}`);
}

main().catch((e) => {
  console.error(e?.response?.data ?? e);
  process.exit(1);
});
