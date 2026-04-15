import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";
async function main() {
  const net = network.name;
  const dir = path.join(__dirname, "..", "deployments");
  const v2 = JSON.parse(fs.readFileSync(path.join(dir, `${net}.atlasV2.json`), "utf-8"));
  const [signer] = await ethers.getSigners();
  const vault = await ethers.getContractAt("AtlasVaultV2", v2.contracts.AtlasVaultV2, signer);
  const tx = await vault.harvest(v2.contracts.Fear);
  console.log(`harvest Fear → ${tx.hash}`);
  await tx.wait();
  const after = await vault.strategies(v2.contracts.Fear);
  console.log(`Fear AFTER: debt=${Number(after[2]) / 1e6}  profit=${Number(after[3]) / 1e6}  loss=${Number(after[4]) / 1e6}`);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
