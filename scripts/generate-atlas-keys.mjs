#!/usr/bin/env node
/**
 * Generates 3 fresh EOAs for the Atlas agents (Fear, Greed, Skeptic).
 * Writes to .keys/atlas-keys.json (gitignored).
 */
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), ".keys", "atlas-keys.json");
if (existsSync(OUT) && !process.argv.includes("--force")) {
  const existing = JSON.parse(await readFile(OUT, "utf-8"));
  console.log("Atlas keys already exist:");
  for (const [k, v] of Object.entries(existing)) console.log(`  ${k.padEnd(10)} ${v.address}`);
  console.log("\nRe-run with --force to regenerate.");
  process.exit(0);
}

const roles = ["fear", "greed", "skeptic"];
const out = {};
for (const r of roles) {
  const pk = generatePrivateKey();
  out[r] = { privateKey: pk, address: privateKeyToAccount(pk).address };
}

await mkdir(resolve(process.cwd(), ".keys"), { recursive: true });
await writeFile(OUT, JSON.stringify(out, null, 2));

console.log("✓ wrote .keys/atlas-keys.json\n");
console.log("Fund these addresses with testnet OKB at https://www.okx.com/xlayer/faucet:");
for (const [k, v] of Object.entries(out)) console.log(`  ${k.padEnd(10)} ${v.address}`);
