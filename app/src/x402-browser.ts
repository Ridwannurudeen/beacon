/**
 * Browser-side x402 EIP-3009 signing. Builds an authorization, asks the
 * connected wallet to sign typed data, then POSTs to the signal endpoint
 * with the X-Payment header. Decodes both X-Payment-Response and
 * X-Cascade-Receipt from the reply.
 */

import { getProvider } from "./wallet.js";

const TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
};

export interface BUSDDescriptor {
  address: string;
  name: string;     // EIP-712 name
  version: string;  // EIP-712 version
  symbol: string;
  decimals: number;
}

export interface PaymentRequired {
  x402Version: 2;
  error?: string;
  accepts: Array<{
    scheme: "exact";
    network: string;
    payTo: string;
    asset: string;
    maxAmountRequired: string;
    maxTimeoutSeconds: number;
    extra: { name: string; version: string };
    description: string;
  }>;
}

export interface PaidResponse {
  ok: boolean;
  status: number;
  body: unknown;
  paymentTx?: string;
  cascadeReceipt?: {
    composite: string;
    upstreams: Array<{ slug: string; author: string; amount: string; settlementTx: string }>;
    buyerSettlementTx: string;
  };
}

function randomNonce(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return "0x" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function payAndCall(
  url: string,
  buyer: string,
  busd: BUSDDescriptor,
  chainId = 1952
): Promise<PaidResponse> {
  // 1) Probe the endpoint to get PaymentRequired
  const probe = await fetch(url, { cache: "no-store" });
  if (probe.status !== 402) {
    return { ok: probe.ok, status: probe.status, body: await probe.text() };
  }
  const required = (await probe.json()) as PaymentRequired;
  const opt = required.accepts?.[0];
  if (!opt) throw new Error("402 returned without accepts");

  // 2) Build authorization
  const now = Math.floor(Date.now() / 1000);
  const auth = {
    from: buyer,
    to: opt.payTo,
    value: opt.maxAmountRequired,
    validAfter: String(now - 5),
    validBefore: String(now + (opt.maxTimeoutSeconds ?? 60)),
    nonce: randomNonce(),
  };

  // 3) Sign EIP-712 typed data via wallet
  const eth = getProvider();
  if (!eth) throw new Error("no wallet");
  const domain = {
    name: opt.extra.name,
    version: opt.extra.version,
    chainId,
    verifyingContract: opt.asset,
  };
  const typedData = {
    types: { ...TYPES, EIP712Domain: [
      { name: "name", type: "string" },
      { name: "version", type: "string" },
      { name: "chainId", type: "uint256" },
      { name: "verifyingContract", type: "address" },
    ] },
    primaryType: "TransferWithAuthorization",
    domain,
    message: auth,
  };
  const signature = (await eth.request<string>({
    method: "eth_signTypedData_v4",
    params: [buyer, JSON.stringify(typedData)],
  })) as string;

  // 4) Encode payload
  const payload = {
    x402Version: 2,
    scheme: "exact",
    network: opt.network,
    payload: { signature, authorization: auth },
  };
  const header = btoa(JSON.stringify(payload));

  // 5) Retry with X-Payment
  const res = await fetch(url, {
    headers: { "X-Payment": header },
    cache: "no-store",
  });
  const txt = await res.text();
  let body: unknown;
  try { body = JSON.parse(txt); } catch { body = txt; }

  let paymentTx: string | undefined;
  let cascadeReceipt: PaidResponse["cascadeReceipt"];
  const xpr = res.headers.get("X-Payment-Response");
  if (xpr) {
    try { paymentTx = JSON.parse(atob(xpr)).transaction; } catch {}
  }
  const xcr = res.headers.get("X-Cascade-Receipt");
  if (xcr) {
    try {
      const decoded = JSON.parse(atob(xcr));
      cascadeReceipt = {
        composite: decoded.receipt.composite,
        buyerSettlementTx: decoded.receipt.buyerSettlementTx,
        upstreams: decoded.receipt.upstreams ?? [],
      };
    } catch {}
  }

  return { ok: res.ok, status: res.status, body, paymentTx, cascadeReceipt };
}

const ERC20_BALANCE_OF = "0x70a08231";
const ERC20_MINT_OPEN = "0x40c10f19"; // mint(address,uint256)

function pad32(hex: string): string {
  return hex.replace(/^0x/, "").padStart(64, "0");
}

export async function getBusdBalance(addr: string, busdAddr: string, rpcUrl = "https://testrpc.xlayer.tech"): Promise<bigint> {
  const data = ERC20_BALANCE_OF + pad32(addr);
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "eth_call", params: [{ to: busdAddr, data }, "latest"], id: 1 }),
  });
  const j = await res.json();
  return BigInt(j.result ?? "0x0");
}

/**
 * Mints bUSD to user via the open mint() on TestToken (testnet only).
 * Returns tx hash.
 */
export async function mintBusd(to: string, amount: bigint, busdAddr: string): Promise<string> {
  const eth = getProvider();
  if (!eth) throw new Error("no wallet");
  const data =
    ERC20_MINT_OPEN +
    pad32(to) +
    pad32(amount.toString(16));
  const tx = await eth.request<string>({
    method: "eth_sendTransaction",
    params: [{ from: to, to: busdAddr, data }],
  });
  return tx as string;
}
