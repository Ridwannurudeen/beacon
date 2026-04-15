# OKX Build X Hackathon — Submission Drafts

Two submissions, one codebase. **DO NOT SUBMIT WITHOUT EXPLICIT USER APPROVAL.**

Deadline: **23:59 UTC · April 15, 2026** (Google Form per official rules).

---

## Submission #1 — X Layer Arena → Atlas V2

### Form fields

| Field | Value |
|---|---|
| **Project name** | Atlas V2 — Multi-strategy Vault with Signed Cascade Receipts |
| **One-liner** | An ERC-4626 vault on X Layer where 3 AI strategies compete for capital. One pays for x402 signals before every trade. Every payment produces an EIP-712 signed cascade receipt anchored on-chain via `CascadeLedger`. |
| **Track** | X Layer Arena |
| **Special prizes claimed** | Best x402 application · Best economy loop · Best MCP integration · Most active agent |
| **GitHub** | https://github.com/Ridwannurudeen/beacon |
| **Live URL** | https://beacon.gudman.xyz |
| **Docs URL** | https://beacon.gudman.xyz/docs.html |
| **Demo video** | _[fill in YouTube / Drive link after recording per `docs/DEMO_SCRIPT.md`]_ |
| **X post** | _[fill in tweet URL with #XLayerHackathon @XLayerOfficial after posting]_ |
| **Team** | Ridwan Nurudeen — solo builder. X: @ridnurudeen |
| **Deployment chain** | X Layer mainnet (chainId 196) + testnet (1952) sandbox |

### Project description (long-form, ~400 words)

Atlas V2 is a working answer to a question worth millions: **does paid AI intelligence outperform free price action in live trading?**

The product is a **vault-custody multi-strategy arena** on X Layer. Users deposit USDT into an ERC-4626-shaped contract (`AtlasVaultV2`). The vault allocates capital to three on-chain strategies:

- **Fear** — momentum trader, rides 30-bps moves
- **Greed** — mean-reverter, fades 50-bps deviations
- **Skeptic** — intelligence-driven, queries the `safe-yield` composite signal via x402 before every trade

Skeptic's edge depends entirely on whether paid intelligence is worth more than its cost. That cost is real on-chain settlement — every signal call settles 4 transactions: 1 buyer payment (Skeptic → composite) + 3 upstream royalty payments (composite → wallet-risk / liquidity-depth / yield-score authors). The composite signs an **EIP-712 CascadeReceipt** of the full payment graph and returns it in `X-Cascade-Receipt`. Skeptic verifies the signature, anchors the receipt to `CascadeLedger.anchorReceipt()`, then trades using the signal. Five real X Layer transactions per Skeptic tick — verifiable on OKLink.

**Onchain OS skills integrated** (real V6 API calls, mainnet only — verified live):

| Signal | Onchain OS skill | Endpoint |
|---|---|---|
| `wallet-risk` | **Wallet** — portfolio scan | `/api/v5/wallet/asset/all-token-balances-by-address` |
| `liquidity-depth` | **DEX Aggregator** — cross-DEX quote | `/api/v6/dex/aggregator/quote` |
| `yield-score` | **Market Data** — price + candles | `/api/v6/dex/market/price-info` + `/api/v6/dex/market/candles` |
| (registry) | **Supported chains** | `/api/v6/dex/aggregator/supported/chain` |
| (registry) | **All tokens** | `/api/v6/dex/aggregator/all-tokens` |

The agent runner uses OKX DEX Aggregator quotes to route trades through the best X Layer liquidity (verified: `CurveNG + Uniswap V3 Fork` returned by live probe).

**MCP server** (`@beacon/mcp`) at `mcp.gudman.xyz/sse` — exposes 6 tools (list_signals, signal_meta, call_signal, atlas_state, list_cascade_receipts, get_cascade_receipt) and 2 resources (`beacon://registry`, `beacon://atlas`) to any MCP-capable agent client.

**Security posture**: 42/42 contract tests pass including 10 adversarial cases (NAV inflation, custody breach, fraud claims). Slither clean of high/medium findings. Foundry invariants in CI. TWAP-priced NAV closes flash-loan manipulation. Pausable guardian role. Slashing-backed strategy stake.

### How it integrates X Layer

1. **All contracts deployed on X Layer** (mainnet + testnet). Real settlement currency.
2. **Real on-chain economic activity** — every Skeptic tick produces 5 X Layer txs (buyer + 3 upstream + anchor). 30+ cascade receipts already on testnet, will replicate on mainnet.
3. **Trades route through X Layer DEX liquidity** via OKX Aggregator (covers Uniswap V3 forks + CurveNG on X Layer).
4. **MCP integration** lets agent clients (Claude, Cursor, Moltbook) call signals + read vault state directly from X Layer.

### Working mechanics (one-paragraph)

Skeptic's agent-runner ticks every ~22 seconds. On each tick: (1) calls `safe-yield.gudman.xyz/signal` → receives 402 → signs EIP-3009 transferWithAuthorization → retries with `X-Payment` → server settles the transfer on-chain → composite forwards x402 calls to 3 upstream signals → each upstream settles separately on-chain → composite signs EIP-712 receipt of the payment graph → returned in `X-Cascade-Receipt`. (2) Skeptic verifies the signature, calls `CascadeLedger.anchorReceipt()` → emits `CascadeSettled` + `UpstreamPaid` events. (3) Skeptic decides whether to BUY/SELL based on the signal score, calls `submitAction(callData)` on its strategy contract → strategy executes the swap via OKX aggregator router from its sub-wallet → equity changes flow through `vault.harvest()` into `cumulativeProfit/Loss`.

### Project onchain identity (as required by the rules)

| Role | Address | Purpose |
|---|---|---|
| Atlas deployer | `0x90329b94b178b45B4a9f25cfCF3979a2aea41542` | Deploys, seeds vault, harvests, emergency-pauses |
| Fear executor | `0x4fc3a3848fFc74f1B608A3961D27F07e4216ae4F` | Submits momentum-strategy intents |
| Greed executor | `0x411C0Ec26BE4628e79090f4e35f9D45079767785` | Submits mean-revert intents |
| Skeptic executor | `0x94f94a111cBBd5e33ec440A199542955a307bB8e` | Pays for signals, anchors receipts, trades |
| wallet-risk author | `0x1e9921B1c6ca20511d9Fc1ADb344882c59002bD6` | Signal payee |
| liquidity-depth author | `0x75D51494005Aa71e0170DCE8086d7CaEC07B7906` | Signal payee |
| yield-score author | `0x20C7Ad3561993FA5777bFF6cd532697d1ca994b0` | Signal payee |
| safe-yield composite | `0x7535ab44553FE7D0B11aa6ac8CBc432c81Cb998D` | Composite signer + cascade payee |

### Mainnet contract addresses (X Layer chainId 196) — **LIVE**

Deployed 2026-04-15 from `0x90329b94b178b45B4a9f25cfCF3979a2aea41542` (~$0.01 total gas).

| Contract | Address |
|---|---|
| AtlasVaultV2 | [`0xe5A5A31145dc44EB3BD701897cd825b2443A6B76`](https://www.oklink.com/xlayer/address/0xe5A5A31145dc44EB3BD701897cd825b2443A6B76) |
| AggregatorStrategy (Fear) | [`0xa551c999d72724eA7d94abc5D803ED030A836273`](https://www.oklink.com/xlayer/address/0xa551c999d72724eA7d94abc5D803ED030A836273) |
| AggregatorStrategy (Greed) | [`0x67B211A37422A245c04688A7aa17Db9a2836CfE2`](https://www.oklink.com/xlayer/address/0x67B211A37422A245c04688A7aa17Db9a2836CfE2) |
| AggregatorStrategy (Skeptic) | [`0x80ff5aCFb497FdD1EB0944847f2F0f3914683C38`](https://www.oklink.com/xlayer/address/0x80ff5aCFb497FdD1EB0944847f2F0f3914683C38) |
| CascadeLedger | [`0x10942C0EAD5346031ED0d8736f6Ab4a73d8c43f1`](https://www.oklink.com/xlayer/address/0x10942C0EAD5346031ED0d8736f6Ab4a73d8c43f1) |
| SlashingRegistry | [`0xBa6b5d940BAd7581463f4b2607131d0C8DcE22f1`](https://www.oklink.com/xlayer/address/0xBa6b5d940BAd7581463f4b2607131d0C8DcE22f1) |
| WithdrawQueue | [`0x5d1885aF211Bde60f2ca0833921B51E572193016`](https://www.oklink.com/xlayer/address/0x5d1885aF211Bde60f2ca0833921B51E572193016) |
| TwapOracle | [`0xaD5FE8f63143Fae56D097685ECF99BEEc612169a`](https://www.oklink.com/xlayer/address/0xaD5FE8f63143Fae56D097685ECF99BEEc612169a) |
| FixedPriceSource | [`0x02D1f2324D9D7323CB27FC504b846e9CB2020433`](https://www.oklink.com/xlayer/address/0x02D1f2324D9D7323CB27FC504b846e9CB2020433) |
| **USDT (settlement)** | [`0x779ded0c9e1022225f8e0630b35a9b54be713736`](https://www.oklink.com/xlayer/address/0x779ded0c9e1022225f8e0630b35a9b54be713736) |
| **WOKB (volatile)** | [`0xe538905cf8410324e03a5a23c1c177a474d59b2b`](https://www.oklink.com/xlayer/address/0xe538905cf8410324e03a5a23c1c177a474d59b2b) |
| **OKX DEX Router** | [`0x8b773D83bc66Be128c60e07E17C8901f7a64F000`](https://www.oklink.com/xlayer/address/0x8b773D83bc66Be128c60e07E17C8901f7a64F000) |

### Testnet contract addresses (X Layer chainId 1952) — sandbox

| Contract | Address |
|---|---|
| AtlasVaultV2 | `0xC968616eB00B80a8A72E9335b739223E212cb4F5` |
| TwapOracle | `0x641eeA815E8d8Ffbf21A190B0Ae67fC577cD607C` |
| CascadeLedger | `0x270Bb62a10b4eEbF5e851ef826ff38b6a2A8ee8A` |
| SlashingRegistry | `0x2726f7Ea4277C33028904B8eD0f6eDD09DAFA9bD` |
| Fear / Greed / Skeptic | `0x90cC...83F1` / `0xba9f...e244` / `0x5c09...8C71` |
| WithdrawQueue | `0x86393DC9E4FD41f689847e1CC119197C248741D9` |
| bUSD (testnet token) | `0xe5A5A31145dc44EB3BD701897cd825b2443A6B76` |

---

## Submission #2 — Skills Arena → @beacon/sdk

### Form fields

| Field | Value |
|---|---|
| **Project name** | @beacon/sdk — Composable x402 signals + cryptographic cascade receipts |
| **One-liner** | The first TypeScript SDK for X Layer that turns any HTTP endpoint into a per-call-priced agentic signal. Composites cascade payments to upstream authors. Every response is an EIP-712 signed CascadeReceipt — not heuristic matching. |
| **Track** | Skills Arena |
| **Special prizes claimed** | Best Uniswap integration · Best data analyst · Most innovative |
| **GitHub** | https://github.com/Ridwannurudeen/beacon (`packages/sdk/`) |
| **npm** | `@beacon/sdk@1.0.0` (ready to `npm publish --access public`) |
| **Demo video** | Same video as submission #1 (cover both products) |
| **X post** | _[separate tweet for #onchainos hashtag]_ |
| **Team** | Ridwan Nurudeen |

### Skill module surface

Three exports:

```ts
import { defineSignal, defineComposite, fetchWithPayment } from "@beacon/sdk";

// Publish a paid signal in 15 lines
const signal = defineSignal({
  slug: "my-signal",
  price: 1500n,                  // 0.0015 USDT per call
  payTo: account.address,
  token: usdtDescriptor,
  chainId: 196,                  // X Layer mainnet
  settlementWallet,
  handler: async (ctx) => ({ score: 88 }),
});

// Cascade payments to upstream signal authors
const composite = defineComposite({
  slug: "safe-yield",
  upstream: [
    { slug: "wallet-risk", url: "...", shareBps: 3300 },
    { slug: "liquidity-depth", url: "...", shareBps: 3300 },
    { slug: "yield-score", url: "...", shareBps: 3400 },
  ],
  handler: async (ctx, upstream) => composite(upstream),
});
// Composite returns the signed CascadeReceipt automatically.

// Client-side
const res = await fetchWithPayment(url, walletClient);
// Decodes both X-Payment-Response (settlement tx) AND X-Cascade-Receipt.
```

### Skill modules used

| Onchain OS / Uniswap module | Where |
|---|---|
| **DEX Aggregator quote** (Onchain OS V6) | `liquidity-depth` signal — pipes a real OKX aggregator quote alongside Uniswap v3 pool reads |
| **Market Data** (Onchain OS V6) | `yield-score` signal — `getPriceInfo` + `getCandles` for market regime context |
| **Wallet** (Onchain OS V5 by-address) | `wallet-risk` signal — portfolio risk factor when value > $100K |
| **Uniswap v3 pool math** | `liquidity-depth` reads `slot0`, `liquidity`, `token0/1` direct via viem |

All Onchain OS calls are HMAC-SHA256 signed (`OK-ACCESS-KEY/SIGN/TIMESTAMP/PASSPHRASE`). See `packages/okx-client/src/index.ts`.

### Live signal endpoints

- https://wallet-risk.gudman.xyz/signal
- https://liquidity-depth.gudman.xyz/signal
- https://yield-score.gudman.xyz/signal
- https://safe-yield.gudman.xyz/signal (composite — signs CascadeReceipts)

### MCP server

- `mcp.gudman.xyz/sse` — `@beacon/mcp` exposes Beacon signals + Atlas state to any MCP client.
- 6 tools: `list_signals`, `signal_meta`, `call_signal`, `atlas_state`, `list_cascade_receipts`, `get_cascade_receipt`
- 2 resources: `beacon://registry`, `beacon://atlas`

### Project description (long-form, ~300 words)

`@beacon/sdk` solves a problem that block agent-marketplace projects have hand-waved through: how do you prove what an agent paid for, when the payment chain spans multiple servers?

The answer is the **CascadeReceipt** — an EIP-712 typed struct listing every upstream payment the composite made for one buyer call (slug, author address, amount, on-chain settlement tx hash). The composite signs it with its wallet. The buyer verifies cryptographically. Optional on-chain anchoring via `CascadeLedger` makes the entire payment graph queryable as events.

The SDK ships three primitives:
- **`defineSignal`** — turns any handler into a paid HTTP endpoint (HTTP 402 → EIP-3009 → on-chain settlement → `X-Payment-Response`).
- **`defineComposite`** — wraps `defineSignal` with automatic upstream fan-out + receipt signing.
- **`fetchWithPayment`** — client side: probes 402, signs, retries, returns response + decoded cascade receipt.

The reference application is **Atlas V2** — three AI strategies on a multi-strategy vault, where one (Skeptic) buys signals through the cascade. It's not a toy: 30+ cascade receipts already anchored on testnet, every Skeptic tick produces real on-chain activity, the agent-runner has been shipping since 2026-04-12.

The SDK works on **X Layer mainnet (196)** and testnet (1952). Coinbase's v1 x402 SDK hardcodes a Zod network enum that excludes X Layer; we built on `@x402/evm` v2 primitives instead.

---

## Honest framing notes (for self-review before submitting)

- **Mainnet deploy** completed before submission — addresses filled in above.
- **NAV anomaly**: Greed shows +534% on testnet because of thin-AMM TWAP drift. We harvested to realize P&L on-chain (visible as `cumulativeProfit`). On mainnet (Uniswap v3 with real liquidity) this disappears.
- **AggregatorStrategy** is the new strategy contract for mainnet — uses OKX aggregator router instead of DemoAMM. Existing TradingStrategy stays for testnet compatibility.
- **PreflightX** is a separate Skills Arena entry (already submitted on its own form). Atlas + @beacon/sdk are the entries we're submitting today.

## Post-submission flight plan

1. `cd packages/sdk && npm publish --access public` → `@beacon/sdk@1.0.0` live on npm
2. Publish `@beacon/mcp` to npm
3. Tweet thread with demo video link, tag `@XLayerOfficial #XLayerHackathon` (and `#onchainos` for the Skills entry)
4. Recruit 1-2 third-party signal authors per `docs/THIRD_PARTY_AUTHOR_OUTREACH.md`
5. Apply for Onchain OS Plugin Store featured spot (Skills Arena top-3 prize)
