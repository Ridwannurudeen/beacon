import { ethers } from "hardhat";
async function main() {
  const [s] = await ethers.getSigners();
  const bal = await ethers.provider.getBalance(s.address);
  const n = await ethers.provider.getTransactionCount(s.address);
  console.log("deployer:", s.address);
  console.log("balance:", Number(bal) / 1e18, "OKB");
  console.log("nonce:", n);
}
main().catch(e => { console.error(e.message); process.exit(1); });
