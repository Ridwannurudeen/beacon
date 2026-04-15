import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Permissionless harvest on each Atlas V2 strategy. Calls
 * vault.harvest(strategy) which in turn calls IStrategy.report() and
 * records profit/loss. Moves unrealized TWAP-valued gains/losses into
 * cumulativeProfit/Loss so the dashboard shows settled accounting.
 */
async function main() {
  const net = network.name;
  const dir = path.join(__dirname, "..", "deployments");
  const v2 = JSON.parse(fs.readFileSync(path.join(dir, `${net}.atlasV2.json`), "utf-8"));
  const [signer] = await ethers.getSigners();
  if (!signer) throw new Error("no signer");
  const vault = await ethers.getContractAt("AtlasVaultV2", v2.contracts.AtlasVaultV2, signer);

  const strategies = [
    { label: "Fear", addr: v2.contracts.Fear },
    { label: "Greed", addr: v2.contracts.Greed },
    { label: "Skeptic", addr: v2.contracts.Skeptic },
  ];

  for (const s of strategies) {
    try {
      const before = await vault.strategies(s.addr);
      console.log(`\n${s.label} BEFORE: debt=${Number(before[2]) / 1e6}  profit=${Number(before[3]) / 1e6}  loss=${Number(before[4]) / 1e6}`);
      const tx = await vault.harvest(s.addr);
      console.log(`  harvest ${s.label} → ${tx.hash}`);
      await tx.wait();
      const after = await vault.strategies(s.addr);
      console.log(`${s.label} AFTER:  debt=${Number(after[2]) / 1e6}  profit=${Number(after[3]) / 1e6}  loss=${Number(after[4]) / 1e6}`);
      await new Promise((r) => setTimeout(r, 3000));
    } catch (e) {
      console.error(`  harvest ${s.label} failed:`, (e as Error).message);
    }
  }
  console.log(`\n✓ harvest complete`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
