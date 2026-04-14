import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Deploys Atlas V2:
 *   - AtlasVaultV2 (real custody, NAV ignores external wallets)
 *   - 3 TradingStrategy contracts (Fear, Greed, Skeptic)
 *   - SlashingRegistry
 *   - CascadeLedger
 *
 * Reuses bUSD, MockX, DemoAMM from the V1 deployment (no redeploy needed).
 * Writes the new addresses to xlayerTestnet.atlasV2.json.
 */
async function main() {
  const net = network.name;
  const dir = path.join(__dirname, "..", "deployments");
  const atlasV1 = JSON.parse(fs.readFileSync(path.join(dir, `${net}.atlas.json`), "utf-8"));
  const tokenDep = JSON.parse(fs.readFileSync(path.join(dir, `${net}.testtoken.json`), "utf-8"));

  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("no deployer");
  console.log(`Deploying Atlas V2 to ${net} from ${deployer.address}`);

  const bUSD = tokenDep.token.address;
  const mockX = atlasV1.contracts.MockX;
  const amm = atlasV1.contracts.DemoAMM;

  const Vault = await ethers.getContractFactory("AtlasVaultV2");
  const vault = await Vault.deploy(bUSD, deployer.address);
  await vault.waitForDeployment();
  const vaultAddr = await vault.getAddress();
  console.log(`AtlasVaultV2:    ${vaultAddr}`);

  const TS = await ethers.getContractFactory("TradingStrategy");
  const fear = await TS.deploy(vaultAddr, bUSD, mockX, amm, "Fear");
  await fear.waitForDeployment();
  const greed = await TS.deploy(vaultAddr, bUSD, mockX, amm, "Greed");
  await greed.waitForDeployment();
  const skeptic = await TS.deploy(vaultAddr, bUSD, mockX, amm, "Skeptic");
  await skeptic.waitForDeployment();
  console.log(`Fear:            ${await fear.getAddress()}  (subWallet ${await fear.subWallet()})`);
  console.log(`Greed:           ${await greed.getAddress()}  (subWallet ${await greed.subWallet()})`);
  console.log(`Skeptic:         ${await skeptic.getAddress()}  (subWallet ${await skeptic.subWallet()})`);

  const Slashing = await ethers.getContractFactory("SlashingRegistry");
  const slashing = await Slashing.deploy(bUSD, deployer.address, deployer.address, 1_000n * 10n ** 6n, 100n * 10n ** 6n);
  await slashing.waitForDeployment();
  console.log(`SlashingRegistry: ${await slashing.getAddress()}`);

  const Ledger = await ethers.getContractFactory("CascadeLedger");
  const ledger = await Ledger.deploy();
  await ledger.waitForDeployment();
  console.log(`CascadeLedger:   ${await ledger.getAddress()}`);

  // Register each strategy with debt limit
  const DEBT_LIMIT = 10_000n * 10n ** 6n;
  for (const [label, strat] of [["Fear", fear], ["Greed", greed], ["Skeptic", skeptic]] as const) {
    await (await vault.registerStrategy(await strat.getAddress(), DEBT_LIMIT)).wait();
    console.log(`  registered ${label}`);
  }

  const out = {
    network: net,
    chainId: network.config.chainId,
    deployer: deployer.address,
    contracts: {
      bUSD,
      MockX: mockX,
      DemoAMM: amm,
      AtlasVaultV2: vaultAddr,
      Fear: await fear.getAddress(),
      FearSubWallet: await fear.subWallet(),
      Greed: await greed.getAddress(),
      GreedSubWallet: await greed.subWallet(),
      Skeptic: await skeptic.getAddress(),
      SkepticSubWallet: await skeptic.subWallet(),
      SlashingRegistry: await slashing.getAddress(),
      CascadeLedger: await ledger.getAddress(),
    },
    deployedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(dir, `${net}.atlasV2.json`), JSON.stringify(out, null, 2));
  console.log(`\n✓ written deployments/${net}.atlasV2.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
