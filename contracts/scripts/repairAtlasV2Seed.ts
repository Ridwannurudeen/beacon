import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * One-shot repair: the V2 bootstrap raw-transferred seed capital before
 * minting shares, leaving `totalAssets() == 30K` and `totalSupply() == 0`.
 * Any external depositor could then mint 1:1 and claim the pre-seeded
 * backing. Repair: admin deposits 30K bUSD into the empty-supply vault
 * via the real `deposit(uint256,address)` path so the founder captures
 * the pre-existing backing legitimately. After this point `totalSupply`
 * and `totalAssets` are in sync and subsequent deposits price fairly.
 *
 * Idempotent — re-runnable; skips if supply > 0.
 */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const net = network.name;
  const dir = path.join(__dirname, "..", "deployments");
  const v2 = JSON.parse(fs.readFileSync(path.join(dir, `${net}.atlasV2.json`), "utf-8"));
  const [admin] = await ethers.getSigners();
  if (!admin) throw new Error("no admin");

  const vault = await ethers.getContractAt("AtlasVaultV2", v2.contracts.AtlasVaultV2, admin);
  const bUSD = await ethers.getContractAt("TestToken", v2.contracts.bUSD, admin);
  const provider = ethers.provider;
  const nonce = () => provider.getTransactionCount(admin.address, "pending");

  const supply = await vault.totalSupply();
  if (supply > 0n) {
    console.log(`  vault already minted (${Number(supply) / 1e6} ATLS), no repair needed`);
    return;
  }

  const totalAssets = await vault.totalAssets();
  console.log(`  totalAssets = ${Number(totalAssets) / 1e6} bUSD, totalSupply = 0`);
  console.log(`  founder will deposit to claim pre-existing backing`);

  // The vault's idle bUSD balance is 0 (30K was routed to strategies). The
  // founder deposit must be >0 assets; we mint fresh bUSD for admin and
  // deposit an amount matching totalAssets so pps = 2 after (founder owns
  // 50%). Or we can just deposit 1 bUSD and admin claims the whole backing
  // as a single share worth ~30K. Either is safe.
  //
  // We pick the "founder deposits = current backing" path so pps stays
  // close to 1.0 for easier UI rendering. Admin temporarily over-donates
  // but retains 50% ownership of a much larger fund.
  const DEPOSIT = totalAssets > 0n ? totalAssets : 30_000n * 10n ** 6n;

  const bal = await bUSD.balanceOf(admin.address);
  if (bal < DEPOSIT) {
    console.log(`  minting ${Number(DEPOSIT - bal) / 1e6} bUSD to admin`);
    const tx = await bUSD.mint(admin.address, DEPOSIT - bal, { nonce: await nonce() });
    await tx.wait();
    await sleep(3000);
  }

  const appr = await bUSD.approve(v2.contracts.AtlasVaultV2, DEPOSIT, { nonce: await nonce() });
  await appr.wait();
  await sleep(3000);

  const tx = await vault["deposit(uint256,address)"](DEPOSIT, admin.address, {
    nonce: await nonce(),
  });
  await tx.wait();
  console.log(`  ✓ founder deposited ${Number(DEPOSIT) / 1e6} bUSD → ${admin.address}`);

  const newSupply = await vault.totalSupply();
  const newAssets = await vault.totalAssets();
  const pps = await vault.pricePerShare();
  console.log(`\n  post-repair: supply=${Number(newSupply) / 1e6}, totalAssets=${Number(newAssets) / 1e6}, pps=${Number(pps) / 1e6}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
