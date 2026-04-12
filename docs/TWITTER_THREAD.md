# Beacon — Launch Thread

**Do not post before user approval.**

---

**Tweet 1/8** (hook)

AI agents need live truth.

Today they scrape, guess, or pay flat subs to APIs that don't pay the source.

We built Beacon — a market where every fact an agent consumes is paid for on the wire, and composite signals cascade payments upstream **by protocol**.

On @XLayerOfficial.

🧵👇

---

**Tweet 2/8** (the primitive)

A Beacon Signal is one thing:

→ an HTTP endpoint priced per call via x402 (EIP-3009 on USDT0, X Layer chainId 196)
→ registered on-chain with price, author, and cumulative revenue
→ consumable by any agent through our SDK or MCP server

5 minutes to publish one.

---

**Tweet 3/8** (the cascade)

Composites are where it gets interesting.

defineComposite({ upstream: [A, B, C], shareBps: [3000, 3000, 3000] })

Every call to the composite = 4 on-chain settlements:
- buyer → composite
- composite → A
- composite → B
- composite → C

No honor system. The cascade IS the call.

---

**Tweet 4/8** (demo clip)

[gif/video of Autopilot click → 4 tx rows populating]

One click.
One payment from the user.
Three automatic payments to upstream signal authors.
Four settlements on X Layer.

Zero protocol extensions.

---

**Tweet 5/8** (the Skill)

@beacon/sdk turns any TS service into a paid agentic signal.

Dune wrapper → signal.
LLM judge → signal.
Nansen MCP → signal.

Composite authors earn margin without running data. They just compose and cascade.

npm i @beacon/sdk

---

**Tweet 6/8** (MCP)

Plug Beacon into Claude Desktop / Cursor / Windsurf in one line.

Any MCP-capable agent discovers signals, pays per call, consumes intelligence.

Any chain can pay X Layer signals. Any X Layer signal can serve any agent.

---

**Tweet 7/8** (the play)

This is what we shipped for @OKX_DEX's Build X Hackathon:

- 4 signals live on X Layer
- 23-test audited on-chain registry + payment splitter
- TypeScript SDK on npm
- MCP server (stdio + SSE)
- Autopilot one-click UI
- 1000+ cascade txs on mainnet

---

**Tweet 8/8** (CTA)

Build a signal today:

📖 github.com/Ridwannurudeen/beacon
🎥 youtube.com/watch?v=... (3-min demo)
🛠 npm i @beacon/sdk

#XLayerHackathon #onchainos

Signals pay upstream. Upstreams pay the source.

We made the source rich.
