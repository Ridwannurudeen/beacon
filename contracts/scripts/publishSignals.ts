import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import type { SignalRegistry } from "../typechain-types";

/**
 * Publishes all Beacon base signals + the safe-yield composite to the on-chain
 * SignalRegistry, and declares safe-yield's composition. Idempotent — if a
 * signal is already registered under (author, slug) it is updated instead.
 *
 * Inputs come from env so deploy private keys stay out of the repo:
 *   WALLET_RISK_URL, LIQUIDITY_DEPTH_URL, YIELD_SCORE_URL, SAFE_YIELD_URL
 *   and the corresponding _PRICE values (defaults per server .env.example).
 */
async function main() {
  const deployPath = path.join(__dirname, "..", "deployments", `${network.name}.json`);
  if (!fs.existsSync(deployPath)) {
    throw new Error(`no deployments/${network.name}.json — run deploy first`);
  }
  const deployment = JSON.parse(fs.readFileSync(deployPath, "utf-8"));
  const registryAddr: string = deployment.contracts.SignalRegistry;

  const [signer] = await ethers.getSigners();
  if (!signer) throw new Error("no signer");
  console.log(`publishing as ${signer.address} to registry ${registryAddr}`);

  const registry = (await ethers.getContractAt(
    "SignalRegistry",
    registryAddr,
    signer
  )) as unknown as SignalRegistry;

  const signals = [
    {
      slug: "wallet-risk",
      url: process.env.WALLET_RISK_URL ?? "https://wallet-risk.beacon.fyi/signal",
      price: BigInt(process.env.WALLET_RISK_PRICE ?? "1000"),
    },
    {
      slug: "liquidity-depth",
      url: process.env.LIQUIDITY_DEPTH_URL ?? "https://liquidity-depth.beacon.fyi/signal",
      price: BigInt(process.env.LIQUIDITY_DEPTH_PRICE ?? "2000"),
    },
    {
      slug: "yield-score",
      url: process.env.YIELD_SCORE_URL ?? "https://yield-score.beacon.fyi/signal",
      price: BigInt(process.env.YIELD_SCORE_PRICE ?? "1500"),
    },
    {
      slug: "safe-yield",
      url: process.env.SAFE_YIELD_URL ?? "https://safe-yield.beacon.fyi/signal",
      price: BigInt(process.env.SAFE_YIELD_PRICE ?? "6000"),
    },
  ];

  const registeredIds: Record<string, string> = {};

  for (const s of signals) {
    const id = await registry.signalIdOf(signer.address, s.slug);
    const existing = await registry.signals(id);
    if (existing.author === ethers.ZeroAddress) {
      console.log(`  register ${s.slug}`);
      const tx = await registry.register(s.slug, s.url, s.price);
      await tx.wait();
    } else {
      console.log(`  update ${s.slug}`);
      const tx = await registry.update(id, s.url, s.price);
      await tx.wait();
    }
    registeredIds[s.slug] = id;
  }

  // Declare safe-yield composition: 30% / 30% / 30%, 10% margin to composite author.
  const compositeId = registeredIds["safe-yield"]!;
  const upstream = [
    registeredIds["wallet-risk"]!,
    registeredIds["liquidity-depth"]!,
    registeredIds["yield-score"]!,
  ];
  const shares = [3000, 3000, 3000];
  console.log(`  setComposition(safe-yield)`);
  const tx = await registry.setComposition(compositeId, upstream, shares);
  await tx.wait();

  const out = { network: network.name, registry: registryAddr, signals: registeredIds };
  fs.writeFileSync(
    path.join(__dirname, "..", "deployments", `${network.name}.signals.json`),
    JSON.stringify(out, null, 2)
  );
  console.log(`\n✓ published ${signals.length} signals`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
