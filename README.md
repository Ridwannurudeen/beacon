# Beacon

**The signal layer of Onchain OS — composable, live-priced intelligence for agents on X Layer.**

Beacon is a marketplace for intelligence signals where every call is paid per-tick via `x402`, and composite signals cascade payments to upstream authors **by protocol, not by honor**. Any agent — on X Layer or any other chain via MCP — buys live truth on the wire, and publishers earn every time their signal is consumed, whether directly or through a composite.

Submitted to the OKX **Build X Hackathon** (Apr 1–15, 2026) across both arenas.

## Why this exists

AI agents need live truth. Today they scrape, guess, or pay flat subscriptions to APIs that don't pay the source. Beacon turns intelligence into a programmable economy:

- **Publish a Signal** — your endpoint becomes an x402-priced resource, registered on-chain.
- **Compose Signals** — your composite automatically pays its upstreams in declared share ratios. Payment cascade is structural — consuming the composite *is* consuming (and paying for) its bases.
- **Agents buy intelligence** — via the Beacon MCP server or the Signal SDK `fetchWithPayment()`. Settlement is EIP-3009 `transferWithAuthorization` on USDT0, on X Layer mainnet.

## Architecture

```
beacon/
├── packages/
│   ├── sdk/       # @beacon/sdk — defineSignal + defineComposite + fetchWithPayment
│   └── mcp/       # @beacon/mcp — MCP server (stdio + SSE) exposing signals to any agent
├── contracts/     # SignalRegistry + PaymentSplitter (Hardhat, OpenZeppelin, 23 tests)
├── signals/
│   ├── wallet-risk/      # base: on-chain risk scoring
│   ├── liquidity-depth/  # base: Uniswap v3 pool reader on X Layer
│   ├── yield-score/      # base: APY across X Layer lending venues
│   └── safe-yield/       # composite: 30/30/30 cascade across the three bases
└── app/           # Vite landing page + Autopilot (Agentic Savings Account UI)
```

## X Layer positioning

- **Chain**: X Layer mainnet, chainId 196 (testnet 195 supported)
- **Settlement token**: USDT0 (`0x779Ded0c9e1022225f8E0630b35a9b54bE713736`) — EIP-3009 compatible, gas-subsidized via x402
- **Explorer**: https://www.oklink.com/xlayer
- **Uniswap v3**: `liquidity-depth` reads pool state directly from the X Layer deployment
- **Aave v3**: `yield-score` reads PoolDataProvider on X Layer

## Core primitives

### `defineSignal`
```ts
import { defineSignal } from "@beacon/sdk";

const signal = defineSignal({
  slug: "my-signal",
  description: "What this returns",
  price: 1000n, // base units — 0.001 USDT0 per call
  payTo: "0xYourWallet",
  settlementWallet, // viem WalletClient with OKB for gas
  handler: async (ctx) => ({ /* your data */ }),
});
```

On any `GET`:
1. If no `X-Payment` header → returns 402 with a `PaymentRequired` body (scheme, network=`evm:196`, payTo, asset, amount, EIP-712 domain).
2. If `X-Payment` present → decodes, verifies the EIP-3009 signature against the USDT0 domain, checks validity window and nonce state on-chain, calls `transferWithAuthorization` to settle, runs the handler, returns `200` with `X-Payment-Response` header carrying the settlement tx hash.

### `defineComposite`
```ts
import { defineComposite } from "@beacon/sdk";

defineComposite({
  slug: "safe-yield",
  price: 6000n,
  payTo: compositeAuthor,
  settlementWallet,
  payerWallet, // pays the upstreams when each call runs
  upstream: [
    { url: "https://wallet-risk.beacon.fyi/signal",    price: 1000n, shareBps: 3000, payTo: author1 },
    { url: "https://liquidity-depth.beacon.fyi/signal", price: 2000n, shareBps: 3000, payTo: author2 },
    { url: "https://yield-score.beacon.fyi/signal",     price: 1500n, shareBps: 3000, payTo: author3 },
  ],
  handler: async ({ ctx, upstreams }) => {
    // upstreams: Record<slug, { data, paymentTx }>
    return composeOutput(upstreams);
  },
});
```

Every call to `safe-yield` emits **four on-chain settlements on X Layer** — one from the buyer to the composite, three from the composite to the upstreams — all surfaced in the response so judges and the Autopilot UI can render the cascade graph.

## Contracts

| Contract | Purpose |
|---|---|
| `SignalRegistry` | Canonical on-chain index: `register / update / retire / setComposition / recordCall`. Author-gated mutations, settlement tx dedup, subgraph-friendly events. |
| `PaymentSplitter` | Pull-based multi-recipient splitter. Composite author's margin (`10000 − Σshares`) auto-credited. `SafeERC20`, `ReentrancyGuard`, custom errors. |

**Test suite**: 23 passing across registry (composition, call recording, ACL, dedup) and splitter (splits, margin, claims, reverts).

## MCP integration

The Beacon MCP server makes every signal a tool that any MCP-capable agent (Claude Desktop, Cursor, Windsurf, …) can discover and consume:

```bash
# stdio (Claude Desktop / Cursor)
AGENT_PRIVATE_KEY=0x... npx @beacon/mcp

# SSE (remote agents)
AGENT_PRIVATE_KEY=0x... npx @beacon/mcp --sse
```

Exposed tools: `list_signals`, `signal_meta`, `call_signal`.
Exposed resources: `beacon://registry`.

Connect to Claude Desktop via:
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

## Quickstart

Prereqs: Node 20+, an EOA with OKB for gas on X Layer, `.env` files populated per each package's `.env.example`.

```bash
npm install

# 1. Contracts — deploy + publish + verify
cd contracts
cp .env.example .env && vi .env
npx hardhat test                              # 23 tests pass
npm run deploy:xlayer                         # writes deployments/xlayer.json
npm run publish:xlayer                        # registers 4 signals + composition

# 2. Signal servers — run each in its own terminal
(cd signals/wallet-risk     && cp .env.example .env && npm run dev)
(cd signals/liquidity-depth && cp .env.example .env && npm run dev)
(cd signals/yield-score     && cp .env.example .env && npm run dev)
(cd signals/safe-yield      && cp .env.example .env && npm run dev)

# 3. Landing + Autopilot
cd app && npm run dev                         # http://localhost:4200

# 4. MCP server (stdio)
cd packages/mcp && AGENT_PRIVATE_KEY=0x... npm start

# 5. Generate traffic (locks Most Active Agent)
cd contracts && npm run traffic:xlayer        # ITERATIONS=500 → 2000 CallRecorded events
```

## Arena mapping

This project ships two submissions from one codebase:

### X Layer Arena — Beacon (the marketplace)
Full-stack agentic app. Agentic Wallet (as payer), x402 on X Layer, Uniswap reads on X Layer, Aave reads on X Layer, composite cascade, Autopilot vertical. Targets:
- **Best x402 application** — protocol-level cascade, not just a payment demo
- **Best economy loop** — pay-per-tick subscription cascades value upstream continuously
- **Best MCP integration** — Signal SDK exposed as MCP server, any agent becomes a buyer
- **Most active agent** — `generateTraffic.ts` + continuous composite cascade

### Skills Arena — @beacon/sdk (the primitive)
`defineSignal` + `defineComposite` + `fetchWithPayment` as a reusable SDK any X Layer dev can publish against in five minutes. Targets:
- **Best data analyst** — `liquidity-depth` does real on-chain Uniswap v3 math
- **Best Uniswap integration** — `liquidity-depth` reads pool slot0, liquidity, reserves
- **Most innovative** — composite cascade is a novel primitive

## Judging criteria mapping

| Criterion (25% each) | How Beacon scores |
|---|---|
| Onchain OS / Uniswap integration + innovation | Custom x402 server using v2 primitives (supports `evm:196` natively), Uniswap v3 pool reader signal, composable SDK |
| X Layer ecosystem integration | USDT0 settlement, on-chain registry, Aave yield reader, Uniswap pool reader, deploy scripts target X Layer mainnet + testnet |
| AI interactive experience | MCP server for Claude/Cursor, Autopilot one-click deploy, live cascade receipt UI |
| Product completeness | 23/23 contract tests, TypeScript strict everywhere, dev server + production build, deployment scripts, traffic generator, docs |

## License

MIT
