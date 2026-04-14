# Beacon · Atlas V2

**Two primitives for the agentic-payment frontier on X Layer.**

- **@beacon/sdk** — composable x402 signal primitives. Every composite response carries an EIP-712-signed `CascadeReceipt` proving the full upstream payment graph.
- **Atlas V2** — vault-custody AI strategy arena. Three on-chain strategies compete for capital; Skeptic pays the Beacon signal layer before each trade and anchors the signed cascade on-chain via `CascadeLedger`.

Submitted to OKX **Build X Hackathon** (Apr 1–15, 2026):
- X Layer Arena → **Atlas V2**
- Skills Arena → **@beacon/sdk**

Live: **https://beacon.gudman.xyz** · Repo: **https://github.com/Ridwannurudeen/beacon**

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

- **Best data analyst** — `liquidity-depth` signal reads Uniswap v3 pool math on X Layer
- **Best Uniswap integration** — direct pool slot0 reads, not a price oracle
- **Most innovative** — `CascadeReceipt` as a novel EIP-712 primitive for provable upstream royalty flow

## License

MIT
