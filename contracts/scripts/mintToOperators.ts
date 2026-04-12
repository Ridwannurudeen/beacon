import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Mints 100k bUSD to each operator + payer so they have balance to participate in
 * x402 settlements + the composite cascade + buyer flows during the demo.
 * TestToken has open `mint()`, so this is just a convenience — anyone can top up.
 */
async function main() {
  const deployPath = path.join(__dirname, "..", "deployments", `${network.name}.testtoken.json`);
  const d = JSON.parse(fs.readFileSync(deployPath, "utf-8"));
  const tokenAddr: string = d.token.address;

  const keysPath = path.join(__dirname, "..", "..", ".keys", "operator-keys.json");
  const keys = JSON.parse(fs.readFileSync(keysPath, "utf-8"));

  const [signer] = await ethers.getSigners();
  if (!signer) throw new Error("no signer");
  const token = await ethers.getContractAt("TestToken", tokenAddr, signer);

  const AMOUNT = 100_000n * 10n ** 6n; // 100k bUSD each

  const recipients = [
    { role: "wallet-risk", addr: keys["wallet-risk"].address },
    { role: "liquidity-depth", addr: keys["liquidity-depth"].address },
    { role: "yield-score", addr: keys["yield-score"].address },
    { role: "safe-yield", addr: keys["safe-yield"].address },
  ];

  for (const r of recipients) {
    const tx = await token.mint(r.addr, AMOUNT);
    await tx.wait();
    console.log(`  minted 100,000 bUSD → ${r.role} (${r.addr})`);
  }

  console.log("\n✓ operators funded");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
