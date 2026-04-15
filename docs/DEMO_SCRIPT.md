# Demo Video Script — Atlas V2 / X Layer Arena

**Length target:** 2 minutes (max 3 per rules).
**Tools:** OBS / ScreenStudio / Loom / QuickTime. Record at 1920×1080. Voice-over recommended but on-screen text captions also work.

**Hosts shown on screen:**
- `https://beacon.gudman.xyz` — main dashboard
- `https://beacon.gudman.xyz/docs.html#demo` — live demo widget
- `https://www.oklink.com/xlayer-test` — block explorer (we'll click through to a tx hash)

**Wallet ready:** Connected to X Layer testnet. Has ~1 bUSD or use the Mint button live.

---

## Beat 1 — Hook (0:00–0:15) · 15s

**Visual:** Full-bleed home page, hero loaded. Mouse hovers but doesn't click yet.

**Voice / caption:**
> "Atlas is a multi-strategy vault on X Layer where AI strategies compete for capital. One of them — Skeptic — pays for intelligence over HTTP using x402 before every trade. Every payment produces an EIP-712 signed receipt anchored on-chain. This is a live demo on X Layer — every transaction you'll see is real."

**On-screen text overlay:** `Atlas V2 · X Layer · Live receipts every ~22 seconds`

---

## Beat 2 — The Vault dashboard (0:15–0:35) · 20s

**Visual:** Click into Vault tab. TVL/PPS charts visible. Hover the strategies tab — show Greed +534%, Fear/Skeptic with realized losses.

**Voice:**
> "Three strategies: Fear runs momentum, Greed runs mean-reversion, Skeptic queries paid signals before each trade. P&L is realized on-chain — every number here came from a contract call, no off-chain accounting."

**On-screen highlight:** Tap each strategy card. Show realized profit/loss numbers (currently Fear −9.6K, Greed +55K, Skeptic −3.9K bUSD).

---

## Beat 3 — The cascade receipt mechanic (0:35–1:10) · 35s · **THE WOW**

**Visual:** Click Receipts tab. Click any row to expand → show 3 upstream payments + composite hash + buyer settlement tx + anchor tx.

**Voice:**
> "When Skeptic asks for the safe-yield signal, the server returns 402 Payment Required. Skeptic signs an EIP-3009 transfer for 0.006 bUSD, retries, and gets 200. The composite then forwards x402 payments to three upstream signal authors — wallet-risk, liquidity-depth, yield-score — and signs an EIP-712 receipt of the entire payment graph. Skeptic verifies the signature and anchors the receipt on the CascadeLedger contract. Five on-chain transactions per Skeptic tick. Cryptographically provable, no trust required."

**On-screen action:** Click the "anchor tx" link → opens OKLink → show CascadeSettled + UpstreamPaid events on-chain.

---

## Beat 4 — Live x402 call (1:10–1:40) · 30s

**Visual:** Navigate to `/docs.html#demo`. Wallet already connected. Click **Call signal →**. MetaMask popup appears (skip the popup in cuts). Response panel populates with the JSON output, composite hash, and 3 upstream tx links.

**Voice:**
> "You don't have to take my word for it. Anyone can pay for a signal call right here. One signature, four real on-chain settlements within seconds."

**On-screen text:** `One click. One signature. Four on-chain payments. EIP-712 signed receipt.`

---

## Beat 5 — Onchain OS skill integration (1:40–1:55) · 15s

**Visual:** Open a new tab → `https://wallet-risk.gudman.xyz` → show JSON `okxSkill: "Wallet (enabled)"`. Then `liquidity-depth.gudman.xyz` → `"DEX aggregator (enabled)"`. Then `yield-score.gudman.xyz` → `"Market Data (enabled)"`. Then `mcp.gudman.xyz/health` → `tools: 6, resources: 2`.

**Voice:**
> "Three Beacon signals integrate live OnchainOS skills — Wallet, DEX Aggregator, and Market Data. The MCP server exposes Atlas state and cascade receipts to any agent client — Claude Desktop, Cursor, Moltbook."

---

## Beat 6 — The thesis + close (1:55–2:00) · 5s

**Visual:** Cut back to home page strategy leaderboard. Greed leads.

**Voice:**
> "Does paid intelligence beat free price action? Watch the leaderboard answer in public on X Layer."

**On-screen end card:**
```
beacon.gudman.xyz
github.com/Ridwannurudeen/beacon
```

---

## Recording checklist

- [ ] Hard-refresh both tabs (Ctrl+Shift+R) so latest UI shows
- [ ] Wallet pre-funded with ≥0.1 bUSD + a little OKB for gas
- [ ] Cursor/MetaMask notification popups disabled in OS settings
- [ ] Browser zoom 100%, full-screen mode
- [ ] Mic levels checked — no clipping
- [ ] If voice-over is hard, switch to on-screen captions only (rules don't require voice)
- [ ] After recording, trim to ≤2:00. Maximum acceptable per rules is 3:00 — keep buffer.
- [ ] Export 1080p MP4 (H.264). Should be ≤200 MB.
- [ ] Upload to YouTube as **unlisted**, or to Google Drive with link sharing on (anyone with link).

## After upload

Paste the URL back to me and I'll insert it into the submission form draft.
