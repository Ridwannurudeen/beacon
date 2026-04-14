import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Deploys an OpenZeppelin TimelockController with a 24-hour delay and
 * transfers AtlasVaultV2 ownership to it. After this point every admin
 * mutation (registerStrategy, setDebtLimit, allocate, recall,
 * emergencyRevokeStrategy, setStrategyExecutor) requires:
 *   1. `schedule(target, value, data, predecessor, salt, delay)` from a
 *      proposer account
 *   2. wait 24 hours
 *   3. `execute(...)` from any executor
 *
 * This closes the admin-centralization gap: no single EOA can instantly
 * revoke a strategy or redirect capital.
 *
 * Proposers + executors = the deployer wallet for the hackathon MVP; in
 * production swap in a 3/5 Safe multisig.
 */
async function main() {
  const net = network.name;
  const dir = path.join(__dirname, "..", "deployments");
  const v2 = JSON.parse(fs.readFileSync(path.join(dir, `${net}.atlasV2.json`), "utf-8"));

  const [admin] = await ethers.getSigners();
  if (!admin) throw new Error("no admin");

  const MIN_DELAY = 24 * 60 * 60; // 24 hours
  const proposers = [admin.address];
  const executors = [admin.address];
  const TLC = await ethers.getContractFactory("TimelockController");
  const timelock = await TLC.deploy(MIN_DELAY, proposers, executors, admin.address);
  await timelock.waitForDeployment();
  const tlAddr = await timelock.getAddress();
  console.log(`TimelockController: ${tlAddr} (24h delay)`);

  const vault = await ethers.getContractAt("AtlasVaultV2", v2.contracts.AtlasVaultV2, admin);
  const tx = await vault.transferOwnership(tlAddr);
  await tx.wait();
  console.log(`  vault.transferOwnership(${tlAddr}) initiated`);
  console.log(`  → timelock must call acceptOwnership() via a scheduled execute() to finalize`);

  v2.contracts.TimelockController = tlAddr;
  v2.timelock = { delaySeconds: MIN_DELAY, proposers, executors };
  fs.writeFileSync(path.join(dir, `${net}.atlasV2.json`), JSON.stringify(v2, null, 2));
  console.log(`\n✓ updated deployments/${net}.atlasV2.json with TimelockController`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
