# Atlas — Demo Video Script (3:00)

**The cascade moment is at 1:30. The leaderboard moment is at 2:30. Hit both.**

Record at 1080p60 in OBS. Clean browser, no extensions visible. Voiceover overdubbed.

---

## [0:00 – 0:20] Hook

**Screen**: Atlas landing page hero, full-bleed.

**Voiceover**:
> "AI agents need intelligence. Today they get it for free. Atlas is the first product where every datapoint an agent buys costs it real money — and every payment cascades to the upstream sources that made it possible. By protocol. On X Layer. Welcome to the decentralized AI hedge fund."

**Text overlay**: `ATLAS — decentralized AI hedge fund on X Layer`

---

## [0:20 – 1:00] The thesis

**Screen**: Scroll the landing page slowly. Show metrics grid (TVL, NAV, trades, cascade spend). Pause on leaderboard.

**Voiceover**:
> "You deposit bUSD. Three AI agents take your capital. Fear chases momentum. Greed mean-reverts. Skeptic — the only one paying for intelligence — consults the Beacon signal layer before every trade. Their PnL competes in real time on-chain. Bad strategies lose. Smart ones earn more capital next epoch."

**Text overlay**: `3 strategies · 1 vault · 1 leaderboard`

---

## [1:00 – 1:30] The signals (zoom into Skeptic)

**Screen**: Click the Skeptic agent card → opens its OKLink address. Show recent transactions: a `transferWithAuthorization` to safe-yield, then a swap on DemoAMM.

**Voiceover**:
> "Watch Skeptic. Before every trade, it pays for `safe-yield` — a composite signal that aggregates wallet risk, liquidity depth, and yield score. Each call costs Skeptic 0.006 bUSD. Cheap, but real. The signal cost shows up directly in its PnL. If the signals don't help Skeptic outperform Fear or Greed, they're overpriced."

---

## [1:30 – 2:15] **THE CASCADE MOMENT**

**Screen**: Scroll back to landing. Hover over the **Live cascade feed** section. Click one of the rows.

**Action**:
1. Pause on the cascade feed for 3 full seconds
2. Click the most recent row → opens OKLink showing the safe-yield settlement tx
3. Wait for OKLink to load
4. Show: that transaction is from Skeptic (`0x94f9…bB8e`) to safe-yield, transferring 6,000 base units of bUSD
5. Switch tab to safe-yield's wallet on OKLink
6. Show: in the same block, safe-yield made 3 outgoing `transferWithAuthorization` calls — to wallet-risk, liquidity-depth, yield-score
7. Pause for 2 full seconds

**Voiceover (over the action, slow and clear)**:
> "Here's what happens when Skeptic asks safe-yield a question. Skeptic signs an EIP-3009 authorization. Safe-yield settles it on-chain. Then safe-yield does the same thing — three more times, paying each upstream signal author. **One agent decision. Four x402 settlements. Cascading by protocol.** Not by trust. Not by API agreement. By the way the cascade is wired."

**Text overlay**: `1 buyer call → 4 settlements on X Layer`

---

## [2:15 – 2:50] **THE LEADERBOARD MOMENT**

**Screen**: Scroll to the agent leaderboard. Show all 3 ranked by PnL.

**Voiceover**:
> "Here's the result, live. After hours of trading and dozens of cascades, this is who's winning. The strategies that buy intelligence are racing the ones that don't. The leaderboard is on-chain, public, and updates every minute. It will be here long after the hackathon ends."

**Action**: Highlight the #1 agent. Read its trade count and PnL %. If Skeptic is winning, narrate that intelligence pays. If Skeptic is losing, narrate that the market is hard and signals aren't free lunch.

---

## [2:50 – 3:00] Close

**Screen**: GitHub repo page.

**Voiceover**:
> "Open source. Audited contracts. Live on X Layer testnet right now. Atlas is what the AI hedge fund looks like when intelligence has a price. Built for OKX Build X."

**Final frame**: `beacon.gudman.xyz · github.com/Ridwannurudeen/beacon · #XLayerHackathon @XLayerOfficial`

---

## Recording checklist

- [ ] All 5 signal services + atlas-agent-runner + atlas-registry-refresh.timer running on VPS
- [ ] Atlas dashboard at https://beacon.gudman.xyz showing real numbers (TVL > 30K, trades > 100)
- [ ] Cascade feed populated with at least 12 events
- [ ] Leaderboard sorted, with at least one positive and one negative PnL agent
- [ ] OKLink open in a tab for tx inspection during the cascade moment
- [ ] Browser cleaned (incognito, no extensions visible)
- [ ] OBS recording 1080p60
- [ ] Voiceover recorded separately
- [ ] Practice the cascade moment 5 times — that's the punchline

## Upload

- YouTube unlisted first → share with me for review
- Public at submission time
- YouTube description: `Atlas — decentralized AI hedge fund on X Layer. Built for OKX Build X Hackathon. https://github.com/Ridwannurudeen/beacon @XLayerOfficial #XLayerHackathon #onchainos`
