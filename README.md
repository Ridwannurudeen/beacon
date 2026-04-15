# Beacon · Atlas V2

**Two primitives for the agentic-payment frontier on X Layer.**

- **@beacon/sdk** — composable x402 signal primitives. Every composite response carries an EIP-712-signed `CascadeReceipt` proving the full upstream payment graph.
- **Atlas V2** — vault-custody AI strategy arena. Three on-chain strategies compete for capital; Skeptic pays the Beacon signal layer before each trade and anchors the signed cascade on-chain via `CascadeLedger`.

Submitted to OKX **Build X Hackathon** (Apr 1–15, 2026):
- X Layer Arena → **Atlas V2**
- Skills Arena → **@beacon/sdk**

Live: **https://beacon.gudman.xyz** · Docs: **https://beacon.gudman.xyz/docs.html** · Repo: **https://github.com/Ridwannurudeen/beacon**

---

## Onchain OS & Uniswap skills used (X Layer mainnet, chainId 196)

Every integration below runs against OKX's live mainnet skill endpoints with HMAC-SHA256 signed requests. The shared client is `packages/okx-client/src/index.ts` — mirrored from the production-hardened PreflightX implementation.

| Skill | Endpoint | Where it's used | Code |
|---|---|---|---|
| **DEX Aggregator Quote** (Onchain OS) | `GET /api/v5/dex/aggregator/quote` | `liquidity-depth` signal returns a real OKX-aggregated route with slippage + liquidity sources alongside raw Uniswap v3 pool math | [`packages/okx-client/src/index.ts#getQuote`](packages/okx-client/src/index.ts) · [`signals/liquidity-depth/src/index.ts`](signals/liquidity-depth/src/index.ts) |
| **Market Data — Price** (Onchain OS) | `GET /api/v5/dex/market/price` | `yield-score` signal enriches APY output with USD spot price | [`packages/okx-client/src/index.ts#getMarketPriceUsd`](packages/okx-client/src/index.ts) · [`signals/yield-score/src/index.ts`](signals/yield-score/src/index.ts) |
| **Market Data — Candles** (Onchain OS) | `GET /api/v5/dex/market/candles` | `yield-score` signal computes recent-change % from 4×1H candles for market-regime context | [`signals/yield-score/src/index.ts`](signals/yield-score/src/index.ts) |
| **Wallet — Portfolio Value** (Onchain OS) | `GET /api/v5/wallet/asset/total-value` + `all-token-balances` | `wallet-risk` signal adds a "high-value wallet" risk factor when OKX reports portfolio > $100K | [`packages/okx-client/src/index.ts#getPortfolio`](packages/okx-client/src/index.ts) · [`signals/wallet-risk/src/index.ts`](signals/wallet-risk/src/index.ts) |
| **Onchain Gateway — Simulate Tx** (Onchain OS) | `POST /api/v5/dex/aggregator/onchain-gateway/simulate-tx` | Pre-flight check before strategies submit trade txs (prevents failed txs) | [`packages/okx-client/src/index.ts#simulateTx`](packages/okx-client/src/index.ts) |
| **Onchain Gateway — Gas Price** (Onchain OS) | `GET /api/v5/dex/aggregator/onchain-gateway/gas-price` | Agent-runner reads current X Layer gas price before submitting strategy txs | [`packages/okx-client/src/index.ts#getGasPriceWei`](packages/okx-client/src/index.ts) |
| **Uniswap v3 (direct pool reads)** | `factory.getPool` · `pool.slot0` · `pool.liquidity` | `liquidity-depth` signal reads live pool state via viem, hashed with OKX aggregator quote above | [`signals/liquidity-depth/src/index.ts`](signals/liquidity-depth/src/index.ts) |

Six Onchain OS core modules in productive use + Uniswap v3 pool reads. All calls are HMAC-authenticated (`OK-ACCESS-KEY` / `OK-ACCESS-SIGN` / `OK-ACCESS-TIMESTAMP` / `OK-ACCESS-PASSPHRASE`).

---

## Project onchain identity

Atlas V2 declares 8 EOAs on X Layer as the project's onchain identity — each with a documented role. All are observable on-chain; addresses below match the `.keys/` manifest committed as deploy config.

**Vault & strategy executors (agent-runner):**

| Role | X Layer address | Responsibility |
|---|---|---|
| **Atlas deployer** | `0x90329b94b178b45B4a9f25cfCF3979a2aea41542` | Deploys contracts, seeds vault, calls `harvest()`, emergency-pause |
| **Fear executor** | `0x4fc3a3848fFc74f1B608A3961D27F07e4216ae4F` | Submits signed trade intents for the momentum strategy |
| **Greed executor** | `0x411C0Ec26BE4628e79090f4e35f9D45079767785` | Submits signed trade intents for the mean-revert strategy |
| **Skeptic executor** | `0x94f94a111cBBd5e33ec440A199542955a307bB8e` | Submits signed trade intents + pays for x402 signals + anchors receipts |

**Beacon signal authors (paid endpoints):**

| Signal | Author address | Paid for | Uses Onchain OS skill |
|---|---|---|---|
| `wallet-risk` | `0x1e9921B1c6ca20511d9Fc1ADb344882c59002bD6` | Wallet risk score | **Wallet** — portfolio snapshot |
| `liquidity-depth` | `0x75D51494005Aa71e0170DCE8086d7CaEC07B7906` | Uniswap v3 pool state | **DEX Aggregator** — cross-DEX quote |
| `yield-score` | `0x20C7Ad3561993FA5777bFF6cd532697d1ca994b0` | Lending venue APYs | **Market Data** — price + candles |
| `safe-yield` (composite) | `0x7535ab44553FE7D0B11aa6ac8CBc432c81Cb998D` | Composite score + signs `CascadeReceipt` | Composes all three above |

Each signal author receives 33% of the `safe-yield` cascade payment on every Skeptic trade — provable via the on-chain `CascadeLedger` + EIP-712 signed receipt returned in the `X-Cascade-Receipt` header. See `cascade` array in [atlas.json](https://beacon.gudman.xyz/atlas.json).

---

## What makes this different

Most "agent marketplaces" prove the primitive and stop. Beacon + Atlas actually **compose** into one working product:

1. `@beacon/sdk` gives developers a `defineComposite({ upstream })` primitive. Every call the composite serves produces an **EIP-712 signed receipt** listing upstream slug, author, amount, and on-chain settlement tx — signed by the composite's wallet.
2. Atlas V2's **Skeptic** strategy actually consumes that receipt: buys the `safe-yield` composite via x402, submits the signed receipt to `CascadeLedger`, and uses the data to pick its next on-chain trade.
3. The vault's NAV is derived purely from **on-chain balance snapshots** of vault-controlled sub-wallets. External EOAs cannot inflate it. Strategies cannot self-report profit. Withdrawals are ERC-4626-compliant against idle liquidity (with an ERC-7540-inspired queue for larger redemptions).

One paid intelligence call from Skeptic produces:
- 1 on-chain x402 settlement (buyer → composite)
- 3 on-chain x402 settlements (composite → each upstream author)
- 1 on-chain `CascadeSettled` event + 3 `UpstreamPaid` events on `CascadeLedger`

Everything visible in the dashboard's Live Cascade Feed. Nothing heuristic.

## Live numbers

```bash
curl https://beacon.gudman.xyz/atlas.json | jq .totals
```

Updates every 60s via systemd timer on the VPS.

## Architecture

```
beacon/
├── packages/
│   ├── sdk/                        # @beacon/sdk v1.0 — published to npm
│   │   ├── receipt.ts              # CascadeReceipt EIP-712 sign / verify
│   │   ├── composite.ts            # defineComposite with middleware-based receipt signing
│   │   ├── signal.ts               # defineSignal — preRoute hook for middleware
│   │   ├── client.ts               # fetchWithPayment
│   │   └── eip3009.ts              # transferWithAuthorization primitives
│   └── mcp/                        # @beacon/mcp — stdio + SSE MCP server
├── contracts/
│   ├── atlas/
│   │   ├── AtlasVaultV2.sol        # ERC-4626 + Pausable + nonReentrant + keeper harvest
│   │   ├── TradingStrategy.sol     # 30-min TWAP valuation
│   │   ├── StrategyBase.sol        # vault-gated capital flows, Yearn-V3-shape report()
│   │   ├── SubWallet.sol           # strategy-owned custody (zero EOA surface)
│   │   ├── TwapOracle.sol          # ring-buffer TWAP to close flash-loan NAV vuln
│   │   ├── SlashingRegistry.sol    # stake + challenge window + fraud proof
│   │   └── WithdrawQueue.sol       # ERC-7540-inspired async redemption
│   ├── CascadeLedger.sol           # EIP-712 receipt registry → CascadeSettled + UpstreamPaid
│   ├── SignalRegistry.sol          # on-chain signal directory
│   ├── PaymentSplitter.sol         # pull-based royalty distribution
│   └── TestToken.sol               # bUSD (EIP-3009 settlement token)
├── atlas/agent-runner/             # 3 strategies: Fear, Greed, Skeptic + MarketMover
│   └── src/runnerV2.ts             # submits signed intents + anchors receipts
├── signals/                        # 4 Beacon signals (all live on *.gudman.xyz)
│   ├── wallet-risk/
│   ├── liquidity-depth/            # reads Uniswap v3 pool math on X Layer
│   ├── yield-score/
│   └── safe-yield/                 # composite, signs receipts
├── subgraph/                       # The Graph subgraph indexing all contracts
├── app/                            # Vite dashboard — V2-native
└── deploy/                         # systemd + nginx + deploy scripts (VPS)
```

## Live V2 deployment (X Layer mainnet, chainId 196)

Verified via OKX V6 DEX API probe (`scripts/probeXLayerAddresses.ts` on 2026-04-15):

| Asset | Address | Notes |
|---|---|---|
| **USDT** (settlement) | `0x779ded0c9e1022225f8e0630b35a9b54be713736` | 6 decimals — Atlas's default settlement token on mainnet |
| **WOKB** (volatile) | `0xe538905cf8410324e03a5a23c1c177a474d59b2b` | 18 decimals — Fear/Greed/Skeptic trade USDT↔WOKB |
| **OKX DEX Router** | `0x8b773D83bc66Be128c60e07E17C8901f7a64F000` | `dexTokenApproveAddress` from OKX V6 `supported/chain` |

**Atlas V2 contracts on X Layer mainnet (deployed 2026-04-15):**

| Contract | Address |
|---|---|
| `AtlasVaultV2` | [`0xe5A5A31145dc44EB3BD701897cd825b2443A6B76`](https://www.oklink.com/xlayer/address/0xe5A5A31145dc44EB3BD701897cd825b2443A6B76) |
| `AggregatorStrategy (Fear)` | [`0xa551c999d72724eA7d94abc5D803ED030A836273`](https://www.oklink.com/xlayer/address/0xa551c999d72724eA7d94abc5D803ED030A836273) |
| `AggregatorStrategy (Greed)` | [`0x67B211A37422A245c04688A7aa17Db9a2836CfE2`](https://www.oklink.com/xlayer/address/0x67B211A37422A245c04688A7aa17Db9a2836CfE2) |
| `AggregatorStrategy (Skeptic)` | [`0x80ff5aCFb497FdD1EB0944847f2F0f3914683C38`](https://www.oklink.com/xlayer/address/0x80ff5aCFb497FdD1EB0944847f2F0f3914683C38) |
| `CascadeLedger` | [`0x10942C0EAD5346031ED0d8736f6Ab4a73d8c43f1`](https://www.oklink.com/xlayer/address/0x10942C0EAD5346031ED0d8736f6Ab4a73d8c43f1) |
| `SlashingRegistry` | [`0xBa6b5d940BAd7581463f4b2607131d0C8DcE22f1`](https://www.oklink.com/xlayer/address/0xBa6b5d940BAd7581463f4b2607131d0C8DcE22f1) |
| `WithdrawQueue` | [`0x5d1885aF211Bde60f2ca0833921B51E572193016`](https://www.oklink.com/xlayer/address/0x5d1885aF211Bde60f2ca0833921B51E572193016) |
| `TwapOracle` | [`0xaD5FE8f63143Fae56D097685ECF99BEEc612169a`](https://www.oklink.com/xlayer/address/0xaD5FE8f63143Fae56D097685ECF99BEEc612169a) |
| `FixedPriceSource` | [`0x02D1f2324D9D7323CB27FC504b846e9CB2020433`](https://www.oklink.com/xlayer/address/0x02D1f2324D9D7323CB27FC504b846e9CB2020433) |

Total deploy cost: **0.0002 OKB (~$0.01)**.

Shared Onchain OS skill credentials → see env setup below.

## Live V2 deployment (X Layer testnet, chainId 1952)

| Contract | Address |
|---|---|
| `AtlasVaultV2` | `0xC968616eB00B80a8A72E9335b739223E212cb4F5` |
| `TwapOracle` | `0x641eeA815E8d8Ffbf21A190B0Ae67fC577cD607C` |
| `TradingStrategy (Fear)` | `0x90cC2ef7586E3d5DAdFb34370Db7718ae2ee83F1` |
| `TradingStrategy (Greed)` | `0xba9f64C987e5D840C73B2d3DE1F3329052aFe244` |
| `TradingStrategy (Skeptic)` | `0x5c096f34Ae4f6E14DB68dd5278741892Afe98C71` |
| `SlashingRegistry` | `0x2726f7Ea4277C33028904B8eD0f6eDD09DAFA9bD` |
| `CascadeLedger` | `0x270Bb62a10b4eEbF5e851ef826ff38b6a2A8ee8A` |
| `WithdrawQueue` | `0x86393DC9E4FD41f689847e1CC119197C248741D9` |
| `DemoAMM` | `0x54F90b6D39284806639Bf376C28FA07d3547Cd76` |
| `MockX` | `0x320830a9094e955EdD366802127f4F056CF4B08B` |
| `SignalRegistry` (Beacon) | `0x02D1f2324D9D7323CB27FC504b846e9CB2020433` |
| `PaymentSplitter` (Beacon) | `0xaD5FE8f63143Fae56D097685ECF99BEEc612169a` |
| `bUSD` (EIP-3009) | `0xe5A5A31145dc44EB3BD701897cd825b2443A6B76` |

Explorer: https://www.oklink.com/xlayer-test

## Live endpoints

| Host | Role |
|---|---|
| `beacon.gudman.xyz` | Dashboard + deposit UI |
| `wallet-risk.gudman.xyz/signal` | Beacon base signal |
| `liquidity-depth.gudman.xyz/signal` | Uniswap v3 pool reader |
| `yield-score.gudman.xyz/signal` | Lending yield aggregator |
| `safe-yield.gudman.xyz/signal` | Composite — signs `CascadeReceipt` |
| `mcp.gudman.xyz/sse` | Beacon MCP server (Claude / Cursor / any MCP client) |

## The three strategies

| Strategy | Logic | Buys signals? |
|---|---|---|
| **Fear** | Momentum follower — rides 30-bps+ moves | No (pure price action) |
| **Greed** | Mean-reverter — fades 50-bps deviations | No (pure statistics) |
| **Skeptic** | Intelligence-driven — queries `safe-yield` composite before each trade | **Yes** (pays per call, anchors receipts on-chain) |

Their competition is the thesis: does **paid intelligence** generate alpha, or does it just drag down PnL? The leaderboard answers in real time.

## Security posture

Hackathon-tier build with production-grade primitives:

- **42/42 Hardhat tests** including a 10-case adversarial suite (NAV inflation, custody breach, self-report manipulation, fraud claims, over-withdraw)
- **Foundry invariants** (`test/foundry/AtlasInvariants.t.sol`) for NAV/share consistency under random op sequences
- **Slither** clean of high/medium findings (remaining flags are intentional timestamp comparisons on TWAP / deadlines)
- **TWAP oracle** closes the flash-loan NAV manipulation vector
- **Pausable** with separate `guardian` role (fast-trigger) vs `admin` (slow, timelock-target)
- **Reentrancy-guarded** deposit / withdraw / allocate / harvest / emergency revoke
- **SafeERC20** + OpenZeppelin 5.0.2 (pinned pre-`mcopy`)
- **GitHub Actions CI** runs tests + Slither + build on every PR

What's **not yet** done (explicitly): professional audit, `TimelockController` ownership transfer (deployed, pending admin action), multi-sig governance, Chainlink-grade price feeds, insurance fund.

## Quickstart

Prereqs: Node 20+, git, an X Layer testnet EOA with ~0.5 OKB.

```bash
git clone https://github.com/Ridwannurudeen/beacon
cd beacon && npm install
cd contracts && npm run test        # 42/42 passing
```

To deploy your own instance, see `docs/DEPLOYMENT_VPS.md`.

## Arena mapping

### X Layer Arena — **Atlas V2**

- **Best x402 application** — Skeptic's per-trade signal cascade, signed and anchored on-chain
- **Best economy loop** — Vault → allocation → strategy → sub-wallet → signal spend → harvest → reallocation
- **Best MCP integration** — `@beacon/mcp` makes every Beacon signal a tool for any MCP-capable agent
- **Most active agent** — 3 strategies + 1 market-mover ticking every 30s, thousands of on-chain events

### Skills Arena — **@beacon/sdk**

- **Best data analyst** — `liquidity-depth` signal reads Uniswap v3 pool math on X Layer **and** pipes an OKX aggregator quote
- **Best Uniswap integration** — direct pool slot0 reads **+** OKX DEX aggregator routing
- **Most innovative** — `CascadeReceipt` as a novel EIP-712 primitive for provable upstream royalty flow

## How this fits X Layer's ecosystem

- **Consumer of X Layer liquidity.** Strategies swap on X Layer DEXes (Uniswap v3 reads; OKX aggregator quotes).
- **Consumer of Onchain OS.** Six distinct core modules integrated across four signal servers + the agent-runner.
- **Producer of Onchain OS-friendly primitives.** `@beacon/mcp` is an MCP server any agent client (Claude, Cursor, Windsurf, Moltbook) can connect to — exposing Beacon signals as MCP tools and Atlas state as MCP resources.
- **On-chain proof, not API trust.** Every signal payment produces an on-chain settlement tx on X Layer; every cascade produces an EIP-712-signed receipt anchored via `CascadeLedger`.
- **Demonstrates the "agentic commerce" thesis.** Skeptic is a live experiment: does paid intelligence beat free price action over many trades? The leaderboard on X Layer is the answer in public.

## Environment

```bash
# contracts/.env (for deploys & testnet operations)
PRIVATE_KEY=0x...               # X Layer deployer EOA
XLAYER_RPC_URL=https://rpc.xlayer.tech
XLAYER_TESTNET_RPC_URL=https://testrpc.xlayer.tech

# signals/*/env (for real Onchain OS skill calls — mainnet only)
ONCHAINOS_API_KEY=...
ONCHAINOS_SECRET_KEY=...
ONCHAINOS_PASSPHRASE=...
OKX_BASE_URL=https://web3.okx.com

# signals/*/env (existing)
SIGNAL_PRIVATE_KEY=0x...
PAY_TO=0x...
TOKEN_ADDRESS=0x...             # USDT0 on mainnet; bUSD on testnet
CHAIN_ID=196                    # or 1952 for testnet
```

## Team

Solo builder for the hackathon. X: **@ridnurudeen**. Previous work: ShieldBot (BNB Chain security), HERMES (NousResearch), Nansen Divergence (Nansen CLI Hackathon), GenLayer projects.

## License

MIT
