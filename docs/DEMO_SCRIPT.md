# Atlas V2 — Demo Video Script (3:00)

**The Cascade Receipt moment is at 1:45. The Adversarial-test moment is at 2:30. Nail both.**

Record 1080p60 in OBS. Clean browser, incognito, no bookmarks bar.

---

## [0:00 – 0:25] Hook

**Screen**: Atlas landing hero.

**Voiceover**:
> "AI agents need intelligence. Today they trust it blindly. Atlas is the first
> product where every signal an agent buys ships with a cryptographically signed
> CascadeReceipt proving exactly who got paid. Built as a production-grade AI
> strategy vault on X Layer. Every dollar of NAV is provably backed by
> vault-controlled custody."

**Text overlay**: `ATLAS — on-chain AI strategy vault on X Layer`

---

## [0:25 – 1:00] The vault's trust spine

**Screen**: Scroll to the "V2 Architecture" section. Hover over each contract card.

**Voiceover**:
> "Custody first. AtlasVaultV2 is ERC-4626-shaped. NAV counts vault idle plus
> the equity of vault-controlled sub-wallets — and nothing else. An attacker
> minting themselves bUSD cannot inflate share price. Tested adversarially."
>
> "Each strategy — Fear, Greed, Skeptic — owns a SubWallet only the strategy
> can invoke. Strategies themselves are vault-gated for capital flow. Off-chain
> agents submit signed TradeIntents but never touch user capital."

**Action**: Click the AtlasVaultV2 card → opens OKLink → show recent allocate() txs.

---

## [1:00 – 1:45] Skeptic buys intelligence

**Screen**: Open Skeptic's TradingStrategy on OKLink → show a submitAction tx.

**Voiceover**:
> "Watch Skeptic. Every tick it reads the AMM spot, its sub-wallet balance,
> and — when the move is significant — queries Beacon's safe-yield composite.
> That call costs 0.006 bUSD out of its book. Real drag on P&L. Intelligence
> isn't free — the market decides whether it was worth it."

**Action**: Transition to Beacon's composite endpoint response in a tab.

---

## [1:45 – 2:30] **THE CASCADE RECEIPT MOMENT**

**Screen**: Terminal.

```bash
# Raw response
curl -s https://safe-yield.gudman.xyz/signal?asset=0xe5A5A31145dc44EB3BD701897cd825b2443A6B76

# Decode the signed receipt from the header
curl -sD /tmp/h -o /tmp/b https://safe-yield.gudman.xyz/signal?asset=0xe5A5A31145dc44EB3BD701897cd825b2443A6B76
grep -i x-cascade-receipt /tmp/h | cut -d: -f2- | base64 -d | jq .
```

**Voiceover (over the reveal)**:
> "This is the receipt. EIP-712 signed by the composite's wallet. It lists
> every upstream — wallet-risk, liquidity-depth, yield-score — with the amount
> paid and the settlement tx hash. Any party — indexer, auditor, another agent —
> verifies cryptographically. **The cascade graph is no longer a heuristic. It
> is signed data.**"

**Action**: Pause 3 full seconds on the decoded JSON showing `upstreams: [...]` with three entries.

**Text overlay**: `1 signed receipt → 3 upstream authors → 4 on-chain settlements`

---

## [2:30 – 2:50] **THE TRUST MOMENT — adversarial tests**

**Screen**: Terminal.

```bash
cd contracts && npx hardhat test test/AtlasV2.test.ts
```

**Voiceover**:
> "Nine tests prove V2's trust claims: outsiders can't inflate NAV, they can't
> move sub-wallet funds, they can't self-report fake profits, slashing
> correctly punishes fraud. 42 tests total. All green."

**Action**: Pause on the ✓ 9 passing line.

---

## [2:50 – 3:00] Close

**Screen**: GitHub.

**Voiceover**:
> "Open source. Production-tier rebuild. Live on X Layer. Atlas: custody,
> cascade, competition — by protocol."

**Final frame**: `beacon.gudman.xyz · github.com/Ridwannurudeen/beacon · #XLayerHackathon @XLayerOfficial`

---

## Recording checklist

- [ ] V2 contracts deployed + strategies allocated (10K bUSD each)
- [ ] atlas-agent-runner-v2 service active on VPS
- [ ] ~20 tick cycles elapsed so sub-wallets hold mixed positions
- [ ] CascadeLedger has at least one submitted receipt (optional but powerful)
- [ ] OKLink open in tab for tx inspection
- [ ] Chrome incognito, no extensions
- [ ] OBS 1080p60
- [ ] Voiceover recorded separately
- [ ] Cascade receipt moment rehearsed 5+ times — the pause is the punchline

## Upload

- YouTube unlisted first → share with reviewer
- Public at submission time
- Description: `Atlas — on-chain AI strategy vault on X Layer. Production-tier V2 with signed CascadeReceipts. https://github.com/Ridwannurudeen/beacon @XLayerOfficial #XLayerHackathon #onchainos`
