import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Deploys the unified Atlas V2 stack:
 *   - TwapOracle (30-min TWAP around DemoAMM spot — closes flash-NAV vuln)
 *   - AtlasVaultV2 (real custody, NAV ignores external wallets)
 *   - 3 TradingStrategy contracts wired to the oracle
 *   - SlashingRegistry
 *   - CascadeLedger
 *   - WithdrawQueue
 *   - TimelockController (24h)
 *
 * Reuses bUSD / MockX / DemoAMM from the earlier base deployment.
 * Writes the full address set to xlayerTestnet.atlasV2.json.
 *
 * This is the ONLY Atlas deploy path post-unification. V1 artifacts remain
 * on chain but are no longer referenced by the app / runners / docs.
 */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

  const provider = ethers.provider;
  async function freshNonce(): Promise<number> {
    // Use "pending" so we skip any stuck/pending txs and grab the next slot.
    return provider.getTransactionCount(deployer.address, "pending");
  }

  // 1. TwapOracle wrapping DemoAMM
  const Twap = await ethers.getContractFactory("TwapOracle");
  const oracle = await Twap.deploy(amm, { nonce: await freshNonce() });
  await oracle.waitForDeployment();
  await sleep(3000);
  const oracleAddr = await oracle.getAddress();
  console.log(`TwapOracle:      ${oracleAddr}`);

  // 2. AtlasVaultV2 (admin = deployer; will transfer to timelock later)
  const Vault = await ethers.getContractFactory("AtlasVaultV2");
  const vault = await Vault.deploy(bUSD, deployer.address, { nonce: await freshNonce() });
  await vault.waitForDeployment();
  await sleep(3000);
  const vaultAddr = await vault.getAddress();
  console.log(`AtlasVaultV2:    ${vaultAddr}`);

  // 3. Three TradingStrategy contracts with oracle wired
  const TS = await ethers.getContractFactory("TradingStrategy");
  const fear = await TS.deploy(vaultAddr, bUSD, mockX, amm, oracleAddr, "Fear", { nonce: await freshNonce() });
  await fear.waitForDeployment();
  await sleep(3000);
  const greed = await TS.deploy(vaultAddr, bUSD, mockX, amm, oracleAddr, "Greed", { nonce: await freshNonce() });
  await greed.waitForDeployment();
  await sleep(3000);
  const skeptic = await TS.deploy(vaultAddr, bUSD, mockX, amm, oracleAddr, "Skeptic", { nonce: await freshNonce() });
  await skeptic.waitForDeployment();
  await sleep(3000);
  console.log(`Fear:            ${await fear.getAddress()}  (subWallet ${await fear.subWallet()})`);
  console.log(`Greed:           ${await greed.getAddress()}  (subWallet ${await greed.subWallet()})`);
  console.log(`Skeptic:         ${await skeptic.getAddress()}  (subWallet ${await skeptic.subWallet()})`);

  // 4. Slashing + CascadeLedger + WithdrawQueue
  const Slashing = await ethers.getContractFactory("SlashingRegistry");
  const slashing = await Slashing.deploy(
    bUSD,
    deployer.address,
    deployer.address,
    1_000n * 10n ** 6n,
    100n * 10n ** 6n,
    { nonce: await freshNonce() }
  );
  await slashing.waitForDeployment();
  await sleep(3000);
  console.log(`SlashingRegistry: ${await slashing.getAddress()}`);

  const Ledger = await ethers.getContractFactory("CascadeLedger");
  const ledger = await Ledger.deploy({ nonce: await freshNonce() });
  await ledger.waitForDeployment();
  await sleep(3000);
  console.log(`CascadeLedger:   ${await ledger.getAddress()}`);

  const WQ = await ethers.getContractFactory("WithdrawQueue");
  const queue = await WQ.deploy(vaultAddr, deployer.address, { nonce: await freshNonce() });
  await queue.waitForDeployment();
  await sleep(3000);
  console.log(`WithdrawQueue:   ${await queue.getAddress()}`);

  // 5. Register each strategy with debt limit
  const DEBT_LIMIT = 10_000n * 10n ** 6n;
  for (const [label, strat] of [["Fear", fear], ["Greed", greed], ["Skeptic", skeptic]] as const) {
    const tx = await vault.registerStrategy(await strat.getAddress(), DEBT_LIMIT, {
      nonce: await freshNonce(),
    });
    await tx.wait();
    await sleep(3000);
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
      TwapOracle: oracleAddr,
      AtlasVaultV2: vaultAddr,
      Fear: await fear.getAddress(),
      FearSubWallet: await fear.subWallet(),
      Greed: await greed.getAddress(),
      GreedSubWallet: await greed.subWallet(),
      Skeptic: await skeptic.getAddress(),
      SkepticSubWallet: await skeptic.subWallet(),
      SlashingRegistry: await slashing.getAddress(),
      CascadeLedger: await ledger.getAddress(),
      WithdrawQueue: await queue.getAddress(),
    },
    // Beacon signal layer (referenced by Skeptic's x402 flow)
    beacon: {
      SignalRegistry: "0x02D1f2324D9D7323CB27FC504b846e9CB2020433",
      PaymentSplitter: "0xaD5FE8f63143Fae56D097685ECF99BEEc612169a",
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
