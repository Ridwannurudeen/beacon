# Beacon — Demo Video Script (3:00)

**Target length: 3:00. The cascade moment MUST land at 2:15–2:30.**

Shoot everything in a clean browser (Chrome, no bookmark bar). Terminal in dark mode. OBS recording at 1080p60 minimum.

---

## [0:00 – 0:20] Hook

**Screen**: Beacon landing page hero, full-bleed.

**Voiceover**:
> "AI agents need live truth. Today they scrape, guess, or pay flat subscriptions to APIs that don't pay the source. Beacon is the signal layer of Onchain OS — a market where every fact an agent consumes is paid for on the wire, and every composite signal cascades its payment to the authors it's built on. By protocol. On X Layer."

**Text overlay**: `BEACON — the signal layer of Onchain OS`

---

## [0:20 – 1:00] Browse signals

**Screen**: Scroll the Beacon landing page. Metrics grid. Signals list (wallet-risk, liquidity-depth, yield-score, safe-yield).

**Voiceover**:
> "Four signals live today. Three bases — wallet risk, Uniswap v3 liquidity depth on X Layer, and cross-venue yield score. And one composite: safe-yield, priced at 0.006 USDT0 per call, which internally subscribes to all three. Click any card and you see its paywall metadata — price, payTo, network, the full x402 contract."

**Action**: Click `liquidity-depth` → opens `/meta` → shows JSON.

**Text overlay**: `Every signal is an x402 resource on X Layer`

---

## [1:00 – 1:45] Compose

**Screen**: Open `signals/safe-yield/src/index.ts` in VS Code. Highlight the `defineComposite({ upstream: [...], shareBps })` block.

**Voiceover**:
> "Here's how the composite is declared. Three upstreams, thirty percent each, ten percent margin to the composite author. That's it. The SDK wires the payment cascade. The composite can't serve a call without paying upstreams — because serving the call IS the fan-out."

**Text overlay**: `defineComposite({ upstream, shareBps }) — cascade by protocol`

---

## [1:45 – 2:30] The Autopilot moment

**Screen**: Beacon Autopilot page.

**Action**:
1. Type a USDT0 treasury address into `asset`.
2. Set amount to `1000`.
3. Click `Query safe-yield →`.

**Voiceover (over the click)**:
> "One click. The Autopilot pays the composite its advertised price. Watch the cascade."

**Expected behavior**:
- Cascade card fills with FOUR rows:
  - `you → safe-yield` (with tx hash linking to oklink.com)
  - `safe-yield → wallet-risk` (tx)
  - `safe-yield → liquidity-depth` (tx)
  - `safe-yield → yield-score` (tx)
- Strategy card shows Safety Score, APY, Best Venue.

**Voiceover (while rows fill)**:
> "One payment from the user. Three automatic payments to upstream signal authors. Four settlements on X Layer. Zero protocol extensions — pure x402, pure EIP-3009, pure cascade."

**Critical**: pause on the cascade list for 2 full seconds so the four tx hashes are readable. **This is the moment that wins.**

---

## [2:30 – 3:00] Scale

**Screen**: OKLink block explorer filtered to the SignalRegistry contract.

**Voiceover**:
> "This is Beacon's on-chain registry. Every registered signal. Every cascade. Publicly indexable. MCP-connectable from any agent in seconds."

**Action**: Switch to terminal, run `claude --mcp beacon` or show the Claude Desktop MCP config with Beacon listed. Type a natural-language prompt: _"Use Beacon's safe-yield signal to check USDT0 treasury on X Layer."_

**Text overlay**: `Any MCP agent. Any chain. One SDK.`

**Voiceover (closing)**:
> "Publish a signal in five minutes. Earn every time an agent, or another signal, consumes it. Beacon. The signal layer of Onchain OS."

**Final frame (2 sec)**: Logo + `beacon.fyi` + `#XLayerHackathon @XLayerOfficial`.

---

## Recording checklist

- [ ] Browser cleaned (no extensions visible, no bookmarks bar, incognito OK)
- [ ] All four signal servers running (wallet-risk :4001, liquidity-depth :4002, yield-score :4003, safe-yield :4010)
- [ ] Registry contract deployed + signals published on X Layer mainnet
- [ ] Traffic generator has seeded at least 1000 `CallRecorded` events — landing page metrics must not show "0"
- [ ] USDT0 funded in payer wallet, OKB for gas in signal wallets
- [ ] oklink.com open in a tab for tx hash verification during takes
- [ ] Rehearsed the Autopilot click 5 times so the cascade renders in < 4s
- [ ] Voiceover recorded separately and overlaid — don't trust live narration

## Upload

- YouTube (unlisted first to share with teammates, public at submission time)
- Include `@XLayerOfficial` + `#XLayerHackathon` in the YouTube description
- Cross-post to Twitter with thread (see `TWITTER_THREAD.md`)
