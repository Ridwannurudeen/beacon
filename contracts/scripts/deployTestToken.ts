import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Deploys TestToken (Beacon USD) — the EIP-3009 settlement token used on X Layer testnet.
 * Mainnet Beacon should point at real USDT0 and NOT deploy this. Writes the address
 * to deployments/<network>.testtoken.json for the signal servers + SDK to consume.
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("no deployer");
  console.log(`deploying TestToken to ${network.name} from ${deployer.address}`);

  const Factory = await ethers.getContractFactory("TestToken");
  const token = await Factory.deploy("Beacon USD", "bUSD", "1");
  await token.waitForDeployment();
  const addr = await token.getAddress();
  console.log(`TestToken (bUSD): ${addr}`);

  // Mint 1,000,000 bUSD to the deployer for traffic generation
  const seedAmount = 1_000_000n * 10n ** 6n;
  const tx = await token.mint(deployer.address, seedAmount);
  await tx.wait();
  console.log(`  seeded ${seedAmount} base units to deployer`);

  const out = {
    network: network.name,
    chainId: network.config.chainId,
    token: {
      address: addr,
      symbol: "bUSD",
      name: "Beacon USD",
      version: "1",
      decimals: 6,
    },
    deployedAt: new Date().toISOString(),
  };
  const outDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `${network.name}.testtoken.json`), JSON.stringify(out, null, 2));
  console.log(`written deployments/${network.name}.testtoken.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
