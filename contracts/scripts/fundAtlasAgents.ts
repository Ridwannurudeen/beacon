import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Funds the 3 Atlas agents with their starting book:
 *   - 5,000 bUSD initial liquidity
 *   - 5,000 MOCK-X initial position
 *   = 10,000 bUSD-equivalent at parity
 *
 * Reads agent addresses from .keys/atlas-keys.json. Doesn't register them on
 * AgentRegistry — the agent-runner does that on first startup.
 */
async function main() {
  const network_name = network.name;
  const deployDir = path.join(__dirname, "..", "deployments");
  const atlas = JSON.parse(
    fs.readFileSync(path.join(deployDir, `${network_name}.atlas.json`), "utf-8")
  );
  const keysPath = path.join(__dirname, "..", "..", ".keys", "atlas-keys.json");
  const keys = JSON.parse(fs.readFileSync(keysPath, "utf-8"));

  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("no deployer");

  const bUSD = await ethers.getContractAt("TestToken", atlas.contracts.bUSD, deployer);
  const mockX = await ethers.getContractAt("MockX", atlas.contracts.MockX, deployer);

  const STARTING_BUSD = 5_000n * 10n ** 6n;
  const STARTING_X = 5_000n * 10n ** 6n;

  for (const role of ["fear", "greed", "skeptic"]) {
    const addr = keys[role].address;
    console.log(`funding ${role.padEnd(8)} ${addr}`);
    await (await bUSD.mint(addr, STARTING_BUSD)).wait();
    await (await mockX.mint(addr, STARTING_X)).wait();
  }
  console.log(`\n✓ each agent funded with 5,000 bUSD + 5,000 MOCKX (10K equity at parity)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
