#!/usr/bin/env node
/**
 * End-to-end x402 smoke test. Uses the deployer key (which kept ~600K bUSD after
 * minting to operators) as the buyer, calls safe-yield, expects four settlement
 * tx hashes on X Layer testnet: one buyer→composite, three composite→upstream.
 */
import { readFileSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";
import { createWalletClient, http } from "viem";
import { xLayerTestnet, fetchWithPayment } from "../packages/sdk/dist/index.js";

const keys = JSON.parse(readFileSync(".keys/operator-keys.json", "utf-8"));
const buyer = privateKeyToAccount(keys.deployer.privateKey);
const wallet = createWalletClient({
  account: buyer,
  chain: xLayerTestnet,
  transport: http(),
});

const SAFE_YIELD_URL = "https://safe-yield.gudman.xyz/signal";
const TEST_ASSET = "0xe5A5A31145dc44EB3BD701897cd825b2443A6B76"; // bUSD itself as "asset"

console.log(`buyer: ${buyer.address}`);
console.log(`calling ${SAFE_YIELD_URL}?asset=${TEST_ASSET}\n`);

const t0 = Date.now();
const res = await fetchWithPayment(
  `${SAFE_YIELD_URL}?asset=${TEST_ASSET}`,
  wallet,
  undefined,
  { chainId: 1952 }
);
const dt = Date.now() - t0;

console.log(`HTTP ${res.status}  (${dt}ms)`);
const xpr = res.headers.get("X-Payment-Response");
if (xpr) {
  const settlement = JSON.parse(Buffer.from(xpr, "base64").toString());
  console.log(`buyer → safe-yield tx: ${settlement.transaction}`);
}

if (res.ok) {
  const body = await res.json();
  console.log(`\noutput:`);
  console.log(JSON.stringify(body.output, null, 2));
  console.log(`\ncascade (${body.cascade.length} upstream settlements):`);
  for (const c of body.cascade) {
    console.log(`  safe-yield → ${c.slug.padEnd(16)} ${c.paymentTx ?? "(no tx)"}`);
  }
} else {
  console.log(await res.text());
}
