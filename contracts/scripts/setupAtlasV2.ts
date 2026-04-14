import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Post-deploy bootstrap for Atlas V2:
 *   1. Sets the executor on each strategy to the corresponding agent EOA
 *   2. Mints bUSD into the vault (deployer mints + transfers) as seed liquidity
 *   3. Allocates capital from the vault to each strategy
 *
 * Reads agent addresses from .keys/atlas-keys.json. Safe to re-run.
 */
async function main() {
  const net = network.name;
  const dir = path.join(__dirname, "..", "deployments");
  const v2 = JSON.parse(fs.readFileSync(path.join(dir, `${net}.atlasV2.json`), "utf-8"));
  const keys = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "..", ".keys", "atlas-keys.json"), "utf-8")
  );

  const [admin] = await ethers.getSigners();
  if (!admin) throw new Error("no admin");

  const vault = await ethers.getContractAt("AtlasVaultV2", v2.contracts.AtlasVaultV2, admin);
  const bUSD = await ethers.getContractAt("TestToken", v2.contracts.bUSD, admin);

  // 1. Set executors
  const mapping = [
    { label: "Fear", addr: v2.contracts.Fear, executor: keys.fear.address },
    { label: "Greed", addr: v2.contracts.Greed, executor: keys.greed.address },
    { label: "Skeptic", addr: v2.contracts.Skeptic, executor: keys.skeptic.address },
  ];
  for (const s of mapping) {
    const tx = await vault.setStrategyExecutor(s.addr, s.executor);
    await tx.wait();
    console.log(`  set ${s.label} executor → ${s.executor}`);
  }

  // 2. Seed vault with 30K bUSD (mint + transfer)
  const SEED = 30_000n * 10n ** 6n;
  await (await bUSD.mint(admin.address, SEED)).wait();
  await (await bUSD.transfer(v2.contracts.AtlasVaultV2, SEED)).wait();
  console.log(`  seeded vault with 30,000 bUSD`);

  // 3. Allocate 10k to each strategy
  const ALLOCATE = 10_000n * 10n ** 6n;
  for (const s of mapping) {
    const tx = await vault.allocate(s.addr, ALLOCATE);
    await tx.wait();
    console.log(`  allocated 10,000 bUSD → ${s.label}`);
  }

  console.log("\n✓ Atlas V2 setup complete");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
