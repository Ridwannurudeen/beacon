# Atlas — the decentralized AI hedge fund on X Layer

**Deposit bUSD. Three competing AI agents trade your capital. Profitable strategies earn more. Every signal an agent consumes is paid for on-chain via x402 — intelligence costs are real performance drag, not theater.**

Submitted to the OKX **Build X Hackathon** (Apr 1–15, 2026) across both arenas:
- **X Layer Arena** — Atlas as the autonomous agent product
- **Skills Arena** — `@beacon/sdk`, the x402 cascade primitive Atlas runs on top of

Live: **https://beacon.gudman.xyz** · Code: **https://github.com/Ridwannurudeen/beacon**

---

## What's actually new

Cascade payments aren't theater anymore. The composite-signal mechanic from the underlying **Beacon** intelligence layer is wrapped inside an actual capital allocation game: agents hold real positions, trade against each other on a real AMM, and lose money when their signal-buying habits don't generate alpha. **The cascade is a cost the agents have to justify with returns** — that's what makes Atlas the first product where x402 cascades have economic meaning, not just demo wattage.

## How it works

```
                   ┌─────────────────────┐
   You ───bUSD───▶ │    AtlasVault       │ ──── ATLS shares
                   │  (ERC4626-shape)    │
                   └─────────┬───────────┘
                             │ NAV walks
                             ▼
                  ┌──────────────────────┐
                  │   AgentRegistry       │
                  │  3 agents · scoreboard│
                  └─┬────────┬────────┬───┘
                    │        │        │
                ┌───▼─┐  ┌───▼─┐  ┌───▼──┐
                │Fear │  │Greed│  │Skeptic│
                │mom  │  │ MR  │  │ +x402 │
                └──┬──┘  └──┬──┘  └──┬───┘
                   │        │        │
                   └────────┴────────┴──────▶ DemoAMM (bUSD/MOCK-X)
                                              │ Uniswap v2 math
                                              │
              ┌───────────────────────────────┘
              │ Skeptic only: pre-trade signal cascade
              ▼
    ┌─────────────────────┐
    │   Beacon            │  safe-yield (composite)
    │  signal layer       │  ├─ wallet-risk
    │                     │  ├─ liquidity-depth
    │                     │  └─ yield-score
    └─────────────────────┘
              │ x402 cascade: 1 buyer call → 4 settlements
              ▼
       USDT0/bUSD on X Layer testnet
```

## The three agents

| Agent | Strategy | Pays for signals? |
|---|---|---|
| **Fear** | Momentum follower (buy 30 bps moves) | No — pure price action |
| **Greed** | Mean reversion (fade 50 bps deviations) | No — pure price stats |
| **Skeptic** | Signal-driven (consults Beacon's `safe-yield` composite before each trade) | Yes — pays for safety scores, eats the cost |

The bet: does Skeptic's intelligence outweigh its drag on returns? The leaderboard answers in real time, on chain.

## Live numbers (snapshot)

Refreshed every 60s on the dashboard. Pull live from `/atlas.json`:

```bash
curl https://beacon.gudman.xyz/atlas.json | jq .totals
```

## Architecture

```
beacon/
├── packages/
│   ├── sdk/              # @beacon/sdk — defineSignal, defineComposite, fetchWithPayment
│   └── mcp/              # MCP server exposing signals to Claude/Cursor agents
├── contracts/
│   ├── AtlasVault.sol     # ERC4626-shape, NAV walks AgentRegistry
│   ├── AgentRegistry.sol  # on-chain leaderboard substrate
│   ├── DemoAMM.sol        # x*y=k pool, Uniswap v2 math
│   ├── MockX.sol          # volatility token agents trade
│   ├── SignalRegistry.sol # Beacon signal directory + call recording
│   ├── PaymentSplitter.sol # cascade payment distribution
│   └── TestToken.sol      # bUSD — EIP-3009 settlement token
├── atlas/
│   └── agent-runner/     # 3 strategies (Fear, Greed, Skeptic) + market-mover
├── signals/              # 4 Beacon signal servers (the intelligence layer)
│   ├── wallet-risk/
│   ├── liquidity-depth/
│   ├── yield-score/
│   └── safe-yield/       # composite — cascades x402 to the 3 above
├── app/                  # Atlas dashboard (Vite + vanilla TS)
└── deploy/               # systemd units + nginx configs for VPS
```

## On-chain (X Layer testnet, chainId 1952)

| Contract | Address |
|---|---|
| AtlasVault | `0x113b660d9F53015cc3478f595835554A5DB7dff2` |
| AgentRegistry | `0x2F41E56C09BB117dD8F1E3B648ADA403e460c454` |
| DemoAMM | `0x54F90b6D39284806639Bf376C28FA07d3547Cd76` |
| MockX | `0x320830a9094e955EdD366802127f4F056CF4B08B` |
| SignalRegistry | `0x02D1f2324D9D7323CB27FC504b846e9CB2020433` |
| PaymentSplitter | `0xaD5FE8f63143Fae56D097685ECF99BEEc612169a` |
| bUSD (TestToken) | `0xe5A5A31145dc44EB3BD701897cd825b2443A6B76` |

Explorer: https://www.oklink.com/xlayer-test

## Live endpoints

| Subdomain | Service |
|---|---|
| `beacon.gudman.xyz` | Atlas dashboard + deposit |
| `wallet-risk.gudman.xyz` | Beacon signal — wallet-risk |
| `liquidity-depth.gudman.xyz` | Beacon signal — liquidity-depth |
| `yield-score.gudman.xyz` | Beacon signal — yield-score |
| `safe-yield.gudman.xyz` | Beacon composite — safe-yield (cascades x402) |
| `mcp.gudman.xyz` | MCP server (SSE) |

## Quickstart (run locally)

```bash
git clone https://github.com/Ridwannurudeen/beacon
cd beacon && npm install
cd contracts && npm run test    # 32/32 passing
```

To deploy your own:

```bash
# 1. Generate keys
node scripts/generate-keys.mjs        # 5 Beacon operator EOAs
node scripts/generate-atlas-keys.mjs  # 3 Atlas agent EOAs

# 2. Fund all 8 with testnet OKB at https://www.okx.com/xlayer/faucet

# 3. Deploy contracts
cd contracts
cp .env.example .env  # set PRIVATE_KEY (deployer)
npm run deploy:xlayer-testnet
npm run deploy-token:xlayer-testnet
npm run deploy-atlas:xlayer-testnet
npm run fund-atlas:xlayer-testnet

# 4. Deploy services to VPS (see docs/DEPLOYMENT_VPS.md)
```

## Hackathon arena mapping

### X Layer Arena — Atlas
- **Best x402 application** — first product where x402 cascades carry economic weight (signal costs hurt PnL)
- **Best economy loop** — capital → agents → signals → authors → reallocation
- **Best MCP integration** — `@beacon/mcp` server (any agent becomes a Beacon buyer; future versions let agents register on Atlas via MCP)
- **Most active agent** — 3 agents trading 24/7 + signal cascades

### Skills Arena — `@beacon/sdk`
- **Best data analyst** — `liquidity-depth` reads Uniswap v3 pool math on X Layer
- **Best Uniswap integration** — same
- **Most innovative** — `defineComposite` cascade primitive

## Tests

```
32 passing (15s)

  AtlasVault, AgentRegistry, DemoAMM    9
  Beacon SignalRegistry                14
  Beacon PaymentSplitter                6
  TestToken (EIP-3009)                  3
```

## License

MIT
