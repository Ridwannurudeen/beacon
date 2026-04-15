import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Continuation of mainnet deploy after first run partial-completed.
 * Reuses already-deployed FixedPriceSource, TwapOracle, AtlasVaultV2.
 * Deploys remaining contracts (3 strategies, slashing, ledger, withdraw queue),
 * registers strategies, writes the final xlayer.atlasV2.json.
 */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (network.config.chainId !== 196) throw new Error("must be --network xlayer");

  const USDT0 = "0x779ded0c9e1022225f8e0630b35a9b54be713736";
  const OTHER = "0xe538905cf8410324e03a5a23c1c177a474d59b2b";
  const ROUTER = "0x8b773D83bc66Be128c60e07E17C8901f7a64F000";
  const FIXED_PRICE = "0x02D1f2324D9D7323CB27FC504b846e9CB2020433";
  const TWAP = "0xaD5FE8f63143Fae56D097685ECF99BEEc612169a";
  const VAULT = "0xe5A5A31145dc44EB3BD701897cd825b2443A6B76";

  const [deployer] = await ethers.getSigners();
  console.log(`Continuing deploy from ${deployer.address}\n`);

  const provider = ethers.provider;
  const freshNonce = () => provider.getTransactionCount(deployer.address, "pending");

  const vault = await ethers.getContractAt("AtlasVaultV2", VAULT, deployer);

  const AS = await ethers.getContractFactory("AggregatorStrategy");
  const fear = await AS.deploy(VAULT, USDT0, OTHER, ROUTER, TWAP, "Fear", { nonce: await freshNonce() });
  await fear.waitForDeployment(); await sleep(3000);
  console.log(`Fear:            ${await fear.getAddress()}`);

  const greed = await AS.deploy(VAULT, USDT0, OTHER, ROUTER, TWAP, "Greed", { nonce: await freshNonce() });
  await greed.waitForDeployment(); await sleep(3000);
  console.log(`Greed:           ${await greed.getAddress()}`);

  const skeptic = await AS.deploy(VAULT, USDT0, OTHER, ROUTER, TWAP, "Skeptic", { nonce: await freshNonce() });
  await skeptic.waitForDeployment(); await sleep(3000);
  console.log(`Skeptic:         ${await skeptic.getAddress()}`);

  const Slashing = await ethers.getContractFactory("SlashingRegistry");
  const slashing = await Slashing.deploy(USDT0, deployer.address, deployer.address, 1_000n * 10n ** 6n, 100n * 10n ** 6n, { nonce: await freshNonce() });
  await slashing.waitForDeployment(); await sleep(3000);
  console.log(`SlashingRegistry: ${await slashing.getAddress()}`);

  const Ledger = await ethers.getContractFactory("CascadeLedger");
  const ledger = await Ledger.deploy({ nonce: await freshNonce() });
  await ledger.waitForDeployment(); await sleep(3000);
  console.log(`CascadeLedger:   ${await ledger.getAddress()}`);

  const WQ = await ethers.getContractFactory("WithdrawQueue");
  const queue = await WQ.deploy(VAULT, deployer.address, { nonce: await freshNonce() });
  await queue.waitForDeployment(); await sleep(3000);
  console.log(`WithdrawQueue:   ${await queue.getAddress()}`);

  const DEBT_LIMIT = 1n * 10n ** 6n; // 1 USDT cap per strategy on mainnet
  for (const [label, strat] of [["Fear", fear], ["Greed", greed], ["Skeptic", skeptic]] as const) {
    const tx = await vault.registerStrategy(await strat.getAddress(), DEBT_LIMIT, { nonce: await freshNonce() });
    await tx.wait(); await sleep(3000);
    console.log(`  registered ${label}`);
  }

  const out = {
    network: network.name,
    chainId: 196,
    deployer: deployer.address,
    contracts: {
      USDT0,
      VolatileToken: OTHER,
      OkxRouter: ROUTER,
      FixedPriceSource: FIXED_PRICE,
      TwapOracle: TWAP,
      AtlasVaultV2: VAULT,
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
    deployedAt: new Date().toISOString(),
    notes: "Mainnet deploy via AggregatorStrategy + OKX DEX router. FixedPriceSource feeds TwapOracle for NAV; agent-runner can update price via setPrice().",
  };
  const dir = path.join(__dirname, "..", "deployments");
  fs.writeFileSync(path.join(dir, "xlayer.atlasV2.json"), JSON.stringify(out, null, 2));
  console.log(`\n✓ wrote deployments/xlayer.atlasV2.json`);
}

main().catch((e) => { console.error(e); process.exit(1); });
