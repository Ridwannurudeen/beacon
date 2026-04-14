import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Allocates capital to each Atlas V2 strategy from the vault's idle balance.
 * Idempotent helper — called after setupAtlasV2 seeded the vault. Skips
 * allocation if a strategy already has currentDebt > 0.
 */
async function main() {
  const net = network.name;
  const dir = path.join(__dirname, "..", "deployments");
  const v2 = JSON.parse(fs.readFileSync(path.join(dir, `${net}.atlasV2.json`), "utf-8"));
  const [admin] = await ethers.getSigners();
  if (!admin) throw new Error("no admin");
  const vault = await ethers.getContractAt("AtlasVaultV2", v2.contracts.AtlasVaultV2, admin);

  const strategies = [
    { label: "Fear", addr: v2.contracts.Fear },
    { label: "Greed", addr: v2.contracts.Greed },
    { label: "Skeptic", addr: v2.contracts.Skeptic },
  ];
  const ALLOC = 10_000n * 10n ** 6n;

  for (const s of strategies) {
    const info = await vault.strategies(s.addr);
    if (info[2] /* currentDebt */ > 0n) {
      console.log(`  ${s.label}: already allocated ${Number(info[2]) / 1e6} bUSD`);
      continue;
    }
    const tx = await vault.allocate(s.addr, ALLOC);
    console.log(`  allocate ${s.label} → ${tx.hash}`);
    await tx.wait();
    // small gap between txs to avoid "replacement underpriced"
    await new Promise((r) => setTimeout(r, 3000));
  }
  console.log(`\n✓ allocation complete`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
