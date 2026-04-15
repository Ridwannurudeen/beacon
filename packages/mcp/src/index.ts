#!/usr/bin/env node
/**
 * Beacon MCP Server
 *
 * Exposes the Beacon signal registry as an MCP server so any MCP-capable
 * agent (Claude Desktop, Cursor, Windsurf, etc.) can:
 *
 *   1. `list_signals` — discover what's on offer (name, price, description)
 *   2. `signal_meta` — inspect a signal's paywall metadata before calling
 *   3. `call_signal` — sign an x402 payment with the agent's Agentic Wallet
 *      (or any injected viem WalletClient) and consume the signal's output
 *
 * Transport: stdio by default (Claude Desktop, Cursor). Pass `--sse` to run
 * over Server-Sent Events for remote agents.
 *
 * Wallet: reads PRIVATE_KEY from env. In an Agentic Wallet deployment the
 * caller wires a TEE-backed signer via a custom WalletClient; the core logic
 * is identical because we delegate all signing to the `@beacon/sdk` client.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { privateKeyToAccount } from "viem/accounts";
import { fetchWithPayment, xLayerWalletClient } from "@beacon/sdk";
import * as dotenv from "dotenv";
import { z } from "zod";
import { createServer } from "node:http";

dotenv.config();

const PRIVATE_KEY = (process.env.AGENT_PRIVATE_KEY ?? process.env.PRIVATE_KEY ?? "") as `0x${string}`;
const REGISTRY_URL = process.env.BEACON_REGISTRY_URL ?? "https://registry.beacon.fyi/signals.json";
const ATLAS_URL = process.env.BEACON_ATLAS_URL ?? "https://beacon.gudman.xyz/atlas.json";
const SSE_MODE = process.argv.includes("--sse");
const SSE_PORT = Number(process.env.MCP_PORT ?? 4100);

if (!PRIVATE_KEY) {
  console.error("[beacon-mcp] AGENT_PRIVATE_KEY required");
  process.exit(1);
}

const walletClient = xLayerWalletClient(privateKeyToAccount(PRIVATE_KEY));

interface RegistryEntry {
  slug: string;
  description: string;
  url: string;
  author: string;
  price: string;
  token: string;
}

/**
 * Loads the public signal directory. In production this points at an indexer
 * reading SignalRegistered events from the on-chain SignalRegistry; for local
 * dev it can be a static JSON file listing running signal servers.
 */
async function loadRegistry(): Promise<RegistryEntry[]> {
  const res = await fetch(REGISTRY_URL);
  if (!res.ok) throw new Error(`registry fetch failed: ${res.status}`);
  return (await res.json()) as RegistryEntry[];
}

interface AtlasSnapshot {
  chain: { id: number; name: string; explorer: string };
  contracts: Record<string, string>;
  vault: { tvl: string; totalSupply: string; pricePerShare: string; paused: boolean };
  strategies: Array<{
    address: string;
    name: string;
    strategy: string;
    equity: string;
    currentDebt: string;
    cumulativeProfit: string;
    cumulativeLoss: string;
    pnlPct: number;
  }>;
  totals: { cascadeEvents: number; totalUpstreamPayments: number };
  cascade: Array<{
    receiptId: string;
    composite: string;
    buyer: string;
    buyerAmount: string;
    buyerSettlementTx: string;
    anchorTx: string;
    block: number;
    upstreams: Array<{ slug: string; author: string; amount: string; settlementTx: string }>;
  }>;
  updatedAt: string;
}

async function loadAtlas(): Promise<AtlasSnapshot> {
  const res = await fetch(ATLAS_URL, { cache: "no-store" } as RequestInit);
  if (!res.ok) throw new Error(`atlas fetch failed: ${res.status}`);
  return (await res.json()) as AtlasSnapshot;
}

const server = new Server(
  { name: "beacon-mcp", version: "0.1.0" },
  { capabilities: { tools: {}, resources: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "list_signals",
      description:
        "List all Beacon signals available for purchase. Returns slug, description, price, and URL for each signal.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "signal_meta",
      description: "Fetch a signal's paywall metadata without paying. Useful for price-checking before calling.",
      inputSchema: {
        type: "object",
        properties: {
          slug: { type: "string", description: "Signal slug from list_signals" },
        },
        required: ["slug"],
        additionalProperties: false,
      },
    },
    {
      name: "call_signal",
      description:
        "Call a Beacon signal, paying with x402 from the agent's wallet. Returns the signal's output and the settlement tx hash on X Layer.",
      inputSchema: {
        type: "object",
        properties: {
          slug: { type: "string", description: "Signal slug (e.g. 'wallet-risk', 'liquidity-depth', 'safe-yield')" },
          query: {
            type: "object",
            description: "Query parameters to pass to the signal (e.g. { address: '0x...' })",
            additionalProperties: { type: "string" },
          },
        },
        required: ["slug"],
        additionalProperties: false,
      },
    },
    {
      name: "atlas_state",
      description:
        "Snapshot of Atlas V2 vault state on X Layer: TVL, NAV/share, strategy equities, realized P&L, and cascade receipt counts.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "list_cascade_receipts",
      description:
        "Return the N most recent EIP-712 signed cascade receipts anchored on-chain via CascadeLedger. Each entry includes the buyer settlement tx, composite signature, and every upstream payment.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Max receipts to return (default 10, max 50)" },
        },
        additionalProperties: false,
      },
    },
    {
      name: "get_cascade_receipt",
      description: "Fetch one cascade receipt by receiptId, including on-chain anchor tx and every upstream payment.",
      inputSchema: {
        type: "object",
        properties: {
          receiptId: { type: "string", description: "The receiptId (keccak256 of the signed struct)" },
        },
        required: ["receiptId"],
        additionalProperties: false,
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;

  if (name === "list_signals") {
    const registry = await loadRegistry();
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            registry.map((s) => ({
              slug: s.slug,
              description: s.description,
              price: `${Number(s.price) / 1_000_000} ${s.token}`,
              url: s.url,
              author: s.author,
            })),
            null,
            2
          ),
        },
      ],
    };
  }

  if (name === "signal_meta") {
    const { slug } = z.object({ slug: z.string() }).parse(args);
    const registry = await loadRegistry();
    const entry = registry.find((s) => s.slug === slug);
    if (!entry) throw new Error(`unknown signal: ${slug}`);
    const res = await fetch(`${entry.url}/meta`);
    return { content: [{ type: "text", text: await res.text() }] };
  }

  if (name === "call_signal") {
    const { slug, query } = z
      .object({ slug: z.string(), query: z.record(z.string()).optional() })
      .parse(args);
    const registry = await loadRegistry();
    const entry = registry.find((s) => s.slug === slug);
    if (!entry) throw new Error(`unknown signal: ${slug}`);

    const url = new URL(entry.url);
    if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);

    const res = await fetchWithPayment(url.toString(), walletClient);
    if (res.status !== 200) {
      throw new Error(`signal call failed: ${res.status} ${await res.text()}`);
    }
    const data = await res.json();
    const settlementHeader = res.headers.get("X-Payment-Response");
    let settlement: unknown = null;
    if (settlementHeader) {
      settlement = JSON.parse(Buffer.from(settlementHeader, "base64").toString("utf-8"));
    }
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ data, settlement }, null, 2),
        },
      ],
    };
  }

  if (name === "atlas_state") {
    const a = await loadAtlas();
    const tvl = Number(BigInt(a.vault.tvl)) / 1_000_000;
    const supply = Number(BigInt(a.vault.totalSupply)) / 1_000_000;
    const pps = Number(BigInt(a.vault.pricePerShare)) / 1_000_000;
    const summary = {
      chain: a.chain,
      vault: {
        tvl: `${tvl.toFixed(2)} bUSD`,
        totalSupply: `${supply.toFixed(2)} ATLS`,
        pricePerShare: pps.toFixed(6),
        paused: a.vault.paused,
      },
      strategies: a.strategies.map((s) => ({
        name: s.name,
        strategy: s.strategy,
        address: s.address,
        equity: (Number(BigInt(s.equity)) / 1_000_000).toFixed(2) + " bUSD",
        debt: (Number(BigInt(s.currentDebt)) / 1_000_000).toFixed(2) + " bUSD",
        realizedProfit: (Number(BigInt(s.cumulativeProfit)) / 1_000_000).toFixed(2) + " bUSD",
        realizedLoss: (Number(BigInt(s.cumulativeLoss)) / 1_000_000).toFixed(2) + " bUSD",
        pnlPct: s.pnlPct,
      })),
      totals: a.totals,
      contracts: a.contracts,
      updatedAt: a.updatedAt,
    };
    return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
  }

  if (name === "list_cascade_receipts") {
    const { limit } = z.object({ limit: z.number().optional() }).parse(args);
    const a = await loadAtlas();
    const n = Math.min(Math.max(limit ?? 10, 1), 50);
    const rows = a.cascade
      .slice()
      .sort((x, y) => y.block - x.block)
      .slice(0, n)
      .map((c) => ({
        receiptId: c.receiptId,
        composite: c.composite,
        buyer: c.buyer,
        buyerAmountBUsd: (Number(BigInt(c.buyerAmount)) / 1_000_000).toFixed(4),
        buyerSettlementTx: c.buyerSettlementTx,
        anchorTx: c.anchorTx,
        block: c.block,
        upstreams: c.upstreams.map((u) => ({
          slug: u.slug,
          author: u.author,
          amountBUsd: (Number(BigInt(u.amount)) / 1_000_000).toFixed(4),
          settlementTx: u.settlementTx,
        })),
      }));
    return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
  }

  if (name === "get_cascade_receipt") {
    const { receiptId } = z.object({ receiptId: z.string() }).parse(args);
    const a = await loadAtlas();
    const c = a.cascade.find((r) => r.receiptId.toLowerCase() === receiptId.toLowerCase());
    if (!c) throw new Error(`receiptId not found: ${receiptId}`);
    return { content: [{ type: "text", text: JSON.stringify(c, null, 2) }] };
  }

  throw new Error(`unknown tool: ${name}`);
});

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    {
      uri: "beacon://registry",
      name: "Beacon Signal Registry",
      description: "Live directory of all published Beacon signals on X Layer.",
      mimeType: "application/json",
    },
    {
      uri: "beacon://atlas",
      name: "Atlas Vault State",
      description: "Live Atlas V2 vault snapshot: TVL, NAV, strategies, cascade receipts.",
      mimeType: "application/json",
    },
  ],
}));

server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
  if (req.params.uri === "beacon://registry") {
    const registry = await loadRegistry();
    return {
      contents: [
        { uri: req.params.uri, mimeType: "application/json", text: JSON.stringify(registry, null, 2) },
      ],
    };
  }
  if (req.params.uri === "beacon://atlas") {
    const atlas = await loadAtlas();
    return {
      contents: [
        { uri: req.params.uri, mimeType: "application/json", text: JSON.stringify(atlas, null, 2) },
      ],
    };
  }
  throw new Error(`unknown resource: ${req.params.uri}`);
});

async function main() {
  if (SSE_MODE) {
    let transport: SSEServerTransport | null = null;
    const http = createServer(async (req, res) => {
      if (req.url === "/sse" && req.method === "GET") {
        transport = new SSEServerTransport("/messages", res);
        await server.connect(transport);
      } else if (req.url?.startsWith("/messages") && req.method === "POST") {
        if (!transport) {
          res.statusCode = 503;
          res.end("no sse session");
          return;
        }
        await transport.handlePostMessage(req, res);
      } else if (req.url === "/health") {
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: true, service: "beacon-mcp", tools: 6, resources: 2 }));
      } else {
        res.statusCode = 404;
        res.end();
      }
    });
    http.listen(SSE_PORT, () => {
      console.error(`[beacon-mcp] SSE listening on :${SSE_PORT}/sse`);
    });
  } else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("[beacon-mcp] stdio server ready");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
