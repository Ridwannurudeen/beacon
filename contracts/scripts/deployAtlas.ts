import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Deploys the Atlas stack on top of the existing Beacon deployment:
 *   - MockX (volatility token agents trade against bUSD)
 *   - DemoAMM (xy=k pool, seeded with bUSD/MOCKX from deployer)
 *   - AgentRegistry (on-chain leaderboard substrate)
 *   - AtlasVault (deposit bUSD → ATLS shares; NAV from registry walk)
 *
 * Reads the existing bUSD address from xlayerTestnet.testtoken.json. Writes the
 * new addresses to xlayerTestnet.atlas.json.
 */
async function main() {
  const network_name = network.name;
  const deploymentsDir = path.join(__dirname, "..", "deployments");
  const tokenPath = path.join(deploymentsDir, `${network_name}.testtoken.json`);
  if (!fs.existsSync(tokenPath)) {
    throw new Error(`bUSD not deployed for ${network_name}. Run deploy-token first.`);
  }
  const bUSDAddr: string = JSON.parse(fs.readFileSync(tokenPath, "utf-8")).token.address;

  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("no deployer signer");
  console.log(`Deploying Atlas to ${network_name} (chainId ${network.config.chainId}) as ${deployer.address}`);
  console.log(`Using bUSD at ${bUSDAddr}\n`);

  const MockX = await ethers.getContractFactory("MockX");
  const mockX = await MockX.deploy();
  await mockX.waitForDeployment();
  const mockXAddr = await mockX.getAddress();
  console.log(`MockX:           ${mockXAddr}`);

  const Registry = await ethers.getContractFactory("AgentRegistry");
  const registry = await Registry.deploy();
  await registry.waitForDeployment();
  const registryAddr = await registry.getAddress();
  console.log(`AgentRegistry:   ${registryAddr}`);

  const AMM = await ethers.getContractFactory("DemoAMM");
  const amm = await AMM.deploy(bUSDAddr, mockXAddr);
  await amm.waitForDeployment();
  const ammAddr = await amm.getAddress();
  console.log(`DemoAMM:         ${ammAddr}`);

  const Vault = await ethers.getContractFactory("AtlasVault");
  const vault = await Vault.deploy(bUSDAddr, mockXAddr, registryAddr, ammAddr);
  await vault.waitForDeployment();
  const vaultAddr = await vault.getAddress();
  console.log(`AtlasVault:      ${vaultAddr}\n`);

  // Seed AMM with 100K bUSD / 100K MOCKX (parity, spot ≈ 1.0)
  const ONE_BUSD = 10n ** 6n;
  const seedBUSD = 100_000n * ONE_BUSD;
  const seedX = 100_000n * ONE_BUSD;

  console.log(`Minting MOCKX to deployer + seeding AMM...`);
  await (await mockX.mint(deployer.address, seedX)).wait();

  const bUSD = await ethers.getContractAt("TestToken", bUSDAddr, deployer);
  await (await bUSD.approve(ammAddr, seedBUSD)).wait();
  await (await mockX.approve(ammAddr, seedX)).wait();
  await (await amm.addLiquidity(seedBUSD, seedX)).wait();
  console.log(`  AMM seeded with ${seedBUSD / ONE_BUSD} bUSD / ${seedX / ONE_BUSD} MOCKX\n`);

  const out = {
    network: network_name,
    chainId: network.config.chainId,
    deployer: deployer.address,
    contracts: {
      bUSD: bUSDAddr,
      MockX: mockXAddr,
      AgentRegistry: registryAddr,
      DemoAMM: ammAddr,
      AtlasVault: vaultAddr,
    },
    seed: {
      bUSD: seedBUSD.toString(),
      mockX: seedX.toString(),
    },
    deployedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(deploymentsDir, `${network_name}.atlas.json`), JSON.stringify(out, null, 2));
  console.log(`✓ written deployments/${network_name}.atlas.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
