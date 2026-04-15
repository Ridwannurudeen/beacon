import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import type { SignalRegistry } from "../typechain-types";

/**
 * Traffic generator: emits CallRecorded events on SignalRegistry to populate
 * the "Most Active Agent" metric. Sends txs with manually-incremented nonces
 * so the mempool swallows them in one burst instead of waiting for each
 * receipt before sending the next.
 *
 * Env:
 *   ITERATIONS=500      — total calls per signal (×4 signals = total events)
 *   BATCH=50            — nonce-managed burst size before waiting
 *   DEMO_PAYER=0x...    — `payer` field in events (defaults to signer)
 */
async function main() {
  const deployPath = path.join(__dirname, "..", "deployments", `${network.name}.json`);
  const signalsPath = path.join(__dirname, "..", "deployments", `${network.name}.signals.json`);
  const deployment = JSON.parse(fs.readFileSync(deployPath, "utf-8"));
  const signalsMap = JSON.parse(fs.readFileSync(signalsPath, "utf-8")).signals as Record<
    string,
    string
  >;

  const [signer] = await ethers.getSigners();
  if (!signer) throw new Error("no signer");

  const bal = await ethers.provider.getBalance(signer.address);
  console.log(`signer: ${signer.address}  balance: ${ethers.formatEther(bal)} OKB`);

  const registry = (await ethers.getContractAt(
    "SignalRegistry",
    deployment.contracts.SignalRegistry,
    signer
  )) as unknown as SignalRegistry;

  const iterations = Number(process.env.ITERATIONS ?? 500);
  const batchSize = Number(process.env.BATCH ?? 50);
  const payer = (process.env.DEMO_PAYER ?? signer.address) as `0x${string}`;

  const targets = [
    { slug: "wallet-risk", id: signalsMap["wallet-risk"]!, amount: 1000n },
    { slug: "liquidity-depth", id: signalsMap["liquidity-depth"]!, amount: 2000n },
    { slug: "yield-score", id: signalsMap["yield-score"]!, amount: 1500n },
    { slug: "safe-yield", id: signalsMap["safe-yield"]!, amount: 6000n },
  ];

  const totalTx = iterations * targets.length;
  console.log(`sending ${totalTx} recordCall txs (batch=${batchSize})`);

  let nonce = await ethers.provider.getTransactionCount(signer.address, "pending");
  let sent = 0;
  let confirmed = 0;

  const pending: Promise<any>[] = [];
  for (let i = 0; i < iterations; i++) {
    for (const t of targets) {
      const n = ethers.hexlify(ethers.randomBytes(32));
      const p = registry.recordCall(t.id, payer, t.amount, n, { nonce: nonce++ })
        .then((tx: any) => tx.wait())
        .then(() => { confirmed++; })
        .catch((e: any) => { console.log(`  tx failed: ${e?.shortMessage ?? e?.message ?? e}`); });
      pending.push(p);
      sent++;

      if (pending.length >= batchSize) {
        await Promise.all(pending.splice(0));
        nonce = await ethers.provider.getTransactionCount(signer.address, "pending");
        console.log(`  confirmed ${confirmed}/${totalTx} (nonce=${nonce})`);
      }
    }
  }

  if (pending.length) {
    await Promise.all(pending);
    console.log(`  confirmed ${confirmed}/${totalTx}`);
  }

  console.log(`\n✓ recorded ${confirmed} CallRecorded events`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
