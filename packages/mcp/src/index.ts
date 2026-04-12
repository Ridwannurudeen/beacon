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
          slug: {
            type: "string",
            description: "Signal slug (e.g. 'wallet-risk', 'liquidity-depth', 'safe-yield')",
          },
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
  ],
}));

server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
  if (req.params.uri === "beacon://registry") {
    const registry = await loadRegistry();
    return {
      contents: [
        {
          uri: req.params.uri,
          mimeType: "application/json",
          text: JSON.stringify(registry, null, 2),
        },
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
