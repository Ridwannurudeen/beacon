#!/usr/bin/env node
/**
 * Generates 5 fresh EOA private keys for Beacon:
 *   - deployer       (deploys contracts + TestToken on X Layer testnet)
 *   - wallet-risk    (operates wallet-risk signal)
 *   - liquidity-depth (operates liquidity-depth signal)
 *   - yield-score    (operates yield-score signal)
 *   - safe-yield     (operates safe-yield composite + acts as composite payer)
 *
 * Writes to .keys/operator-keys.json (gitignored). Each entry includes the
 * private key, the derived address, and a short human label.
 *
 * Re-running this script rewrites the file — DO NOT re-run after you've funded
 * wallets or you'll lose the keys to money.
 */
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const OUT_DIR = resolve(process.cwd(), ".keys");
const OUT_FILE = resolve(OUT_DIR, "operator-keys.json");

if (existsSync(OUT_FILE) && !process.argv.includes("--force")) {
  console.error(`✗ ${OUT_FILE} already exists. Re-run with --force to overwrite.`);
  process.exit(1);
}

const roles = ["deployer", "wallet-risk", "liquidity-depth", "yield-score", "safe-yield"];
const keys = {};
for (const role of roles) {
  const pk = generatePrivateKey();
  const account = privateKeyToAccount(pk);
  keys[role] = { privateKey: pk, address: account.address };
}

await mkdir(OUT_DIR, { recursive: true });
await writeFile(OUT_FILE, JSON.stringify(keys, null, 2));

console.log(`✓ wrote ${OUT_FILE}\n`);
console.log("Fund these addresses with testnet OKB at https://www.okx.com/xlayer/faucet:");
for (const [role, v] of Object.entries(keys)) {
  console.log(`  ${role.padEnd(18)} ${v.address}`);
}
console.log("\nAll addresses need a few cents of OKB for gas.");
console.log("The deployer only needs to deploy + mint — fund it once with enough for ~10 tx.");
console.log("\nKEEP .keys/operator-keys.json PRIVATE. It's gitignored but DO NOT share it.");
