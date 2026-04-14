# @beacon/sdk

**Composable, x402-priced signal primitives for X Layer — with cryptographic cascade receipts.**

Beacon turns any HTTP endpoint into a per-call-priced agentic signal. Composites cascade payments to upstream authors by protocol, and every response includes an EIP-712 signed `CascadeReceipt` that proves the full upstream payment graph — no heuristic matching, no trusted middleware.

## Install

```bash
npm install @beacon/sdk viem hono
```

## Publish a signal in 5 minutes

```ts
import { defineSignal, xLayerTestnetWalletClient } from "@beacon/sdk";
import { privateKeyToAccount } from "viem/accounts";
import { serve } from "@hono/node-server";
import { Hono } from "hono";

const account = privateKeyToAccount(process.env.PRIVATE_KEY! as `0x${string}`);
const settlementWallet = xLayerTestnetWalletClient(account);

const signal = defineSignal({
  slug: "my-signal",
  description: "What this signal returns",
  price: 1500n, // 0.0015 bUSD per call
  payTo: account.address,
  token: {
    address: "0xe5A5A31145dc44EB3BD701897cd825b2443A6B76",
    symbol: "bUSD",
    decimals: 6,
    eip712Name: "Beacon USD",
    eip712Version: "1",
  },
  chainId: 1952, // X Layer testnet
  settlementWallet,
  handler: async (ctx) => ({
    // return your data here
    timestamp: Date.now(),
    value: Math.random(),
  }),
});

const app = new Hono();
app.route("/signal", signal.app);
serve({ fetch: app.fetch, port: 4000 });
```

That's it. Your endpoint is now a paid x402 resource on X Layer.

## Compose signals with protocol-level cascade

```ts
import { defineComposite } from "@beacon/sdk";

const composite = defineComposite({
  slug: "safe-yield",
  description: "Safety-adjusted yield recommendation",
  price: 6000n,
  payTo: compositeAuthor,
  settlementWallet,
  payerWallet, // this wallet pays upstreams
  cascadeLedger: "0x5abb55245023E7886234102ff338bB70FacCF761",
  upstream: [
    { url: "https://wallet-risk.example/signal",    price: 1000n, shareBps: 3000, payTo: author1 },
    { url: "https://liquidity-depth.example/signal", price: 2000n, shareBps: 3000, payTo: author2 },
    { url: "https://yield-score.example/signal",     price: 1500n, shareBps: 3000, payTo: author3 },
  ],
  handler: async ({ ctx, upstreams }) => {
    // your composition logic, given the fetched upstream data
    return combine(upstreams["wallet-risk"].data, ...);
  },
});
```

Every response now ships with a signed `CascadeReceipt` in the `X-Cascade-Receipt` header. Any consumer verifies the graph cryptographically:

```ts
import {
  decodeCascadeReceiptHeader,
  verifyCascadeReceipt,
} from "@beacon/sdk";

const res = await fetchWithPayment(compositeUrl, wallet);
const signed = decodeCascadeReceiptHeader(res.headers.get("X-Cascade-Receipt")!);
const signer = await verifyCascadeReceipt(signed);
// signer is guaranteed to be signed.receipt.composite — the cascade graph
// (all upstream slugs, authors, amounts, settlement tx hashes) is authenticated.
```

## Consume a signal as an agent

```ts
import { fetchWithPayment } from "@beacon/sdk";

const res = await fetchWithPayment(
  "https://safe-yield.example/signal?asset=0x...",
  walletClient,
  undefined,
  { chainId: 1952 }
);
const data = await res.json();
```

One call. Automatic x402 negotiation, EIP-3009 signing, retry with payment. Works on X Layer mainnet (chainId 196) and testnet (1952) out of the box.

## MCP integration

`@beacon/mcp` exposes every signal as a tool any Claude/Cursor/Windsurf agent can discover and consume.

```json
{
  "mcpServers": {
    "beacon": {
      "command": "npx",
      "args": ["@beacon/mcp"],
      "env": { "AGENT_PRIVATE_KEY": "0x..." }
    }
  }
}
```

## What makes this different

| Existing x402 demos | @beacon/sdk |
|---|---|
| Pay for one HTTP response | Pay once, cascade to N upstream authors by protocol |
| Tx hash in a response header | Cryptographic EIP-712 CascadeReceipt signed by the composite |
| Heuristic block-window matching to reconstruct graph | Deterministic, on-chain-verifiable receipt graph |
| Doesn't support X Layer (Coinbase v1 enum-gated) | First-class X Layer via `@x402/evm` v2 primitives |

## Docs

- Full quickstart: [beacon.gudman.xyz](https://beacon.gudman.xyz)
- CascadeReceipt spec: see `src/receipt.ts`
- On-chain registry: `SignalRegistry` at `0x02D1f2324D9D7323CB27FC504b846e9CB2020433` on X Layer testnet
- CascadeLedger (on-chain receipt anchoring): `0x5abb55245023E7886234102ff338bB70FacCF761`

## License

MIT
