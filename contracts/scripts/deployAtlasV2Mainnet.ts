import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Mainnet deploy for Atlas V2 on X Layer (chainId 196).
 *
 * Differences from the testnet deploy:
 *   - Uses real USDT0 as settlement asset (no open-mint bUSD)
 *   - Deploys AggregatorStrategy contracts that execute via the OKX DEX
 *     Aggregator's router (Onchain OS DEX skill), not DemoAMM
 *   - Uses a user-supplied TwapOracle against a real Uniswap v3 pool
 *
 * Verified addresses (via live OKX V6 DEX API probe, 2026-04-15):
 *   USDT on X Layer: 0x779ded0c9e1022225f8e0630b35a9b54be713736 (6 decimals)
 *   WOKB:            0xe538905cf8410324e03a5a23c1c177a474d59b2b (18 decimals)
 *   OKX DEX router:  0x8b773D83bc66Be128c60e07E17C8901f7a64F000 (dexTokenApproveAddress)
 *
 * Override via env vars if needed:
 *   PRIVATE_KEY                     — deployer EOA (needs ~0.5 OKB for gas)
 *   USDT0_ADDRESS (default above)   — settlement token
 *   VOLATILE_TOKEN (default WOKB)
 *   OKX_DEX_ROUTER (default above)
 *   TWAP_ORACLE_ADDRESS (optional)
 *
 * Usage:
 *   PRIVATE_KEY=0x... npx hardhat run scripts/deployAtlasV2Mainnet.ts --network xlayer
 */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const DEFAULT_USDT = "0x779ded0c9e1022225f8e0630b35a9b54be713736";
const DEFAULT_WOKB = "0xe538905cf8410324e03a5a23c1c177a474d59b2b";
const DEFAULT_ROUTER = "0x8b773D83bc66Be128c60e07E17C8901f7a64F000";

function requireEnv(k: string): string {
  const v = process.env[k];
  if (!v) throw new Error(`${k} required in env`);
  return v;
}

async function main() {
  if (network.config.chainId !== 196) {
    throw new Error(`Wrong network. Expected X Layer mainnet (196), got ${network.config.chainId}`);
  }
  const net = network.name;
  const dir = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const USDT0 = process.env.USDT0_ADDRESS ?? DEFAULT_USDT;
  const OTHER = process.env.VOLATILE_TOKEN ?? DEFAULT_WOKB;
  const ROUTER = process.env.OKX_DEX_ROUTER ?? DEFAULT_ROUTER;
  const ORACLE_OVERRIDE = process.env.TWAP_ORACLE_ADDRESS;

  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("no deployer");
  console.log(`Deploying Atlas V2 to ${net} (chainId 196) from ${deployer.address}`);
  console.log(`  USDT0:  ${USDT0}`);
  console.log(`  OTHER:  ${OTHER}`);
  console.log(`  ROUTER: ${ROUTER}`);

  const provider = ethers.provider;
  async function freshNonce(): Promise<number> {
    return provider.getTransactionCount(deployer.address, "pending");
  }

  // 1) Oracle — either reuse an existing one or deploy a stub that returns 1e18
  //    (the agent-runner recomputes TWAP off-chain via OKX market skill; on-chain
  //    valuation is only used for NAV snapshots, not trade sizing).
  let oracleAddr: string;
  let priceSourceAddr: string;
  if (ORACLE_OVERRIDE) {
    oracleAddr = ORACLE_OVERRIDE;
    priceSourceAddr = "(reused)";
    console.log(`TwapOracle:      ${oracleAddr}  (reused)`);
  } else {
    // 1a) FixedPriceSource — bootstrapped with current OKX-quoted USDT/WOKB
    //     ratio (~85 USDT per WOKB at OKB price ~$85). Owner can updatePrice()
    //     anytime; downstream TwapOracle smooths over 30 minutes.
    //     Price scaled to 1e18: 85e18 means "1 WOKB = 85 USDT".
    const initialPrice = process.env.INITIAL_PRICE ?? (85n * 10n ** 18n).toString();
    const FPS = await ethers.getContractFactory("FixedPriceSource");
    const fps = await FPS.deploy(initialPrice, { nonce: await freshNonce() });
    await fps.waitForDeployment();
    await sleep(3000);
    priceSourceAddr = await fps.getAddress();
    console.log(`FixedPriceSource: ${priceSourceAddr}  (price ${Number(initialPrice) / 1e18} USDT/WOKB)`);

    // 1b) TwapOracle wrapping the FixedPriceSource
    const Twap = await ethers.getContractFactory("TwapOracle");
    const oracle = await Twap.deploy(priceSourceAddr, { nonce: await freshNonce() });
    await oracle.waitForDeployment();
    await sleep(3000);
    oracleAddr = await oracle.getAddress();
    console.log(`TwapOracle:      ${oracleAddr}`);
  }

  // 2) AtlasVaultV2
  const Vault = await ethers.getContractFactory("AtlasVaultV2");
  const vault = await Vault.deploy(USDT0, deployer.address, { nonce: await freshNonce() });
  await vault.waitForDeployment();
  await sleep(3000);
  const vaultAddr = await vault.getAddress();
  console.log(`AtlasVaultV2:    ${vaultAddr}`);

  // 3) Three AggregatorStrategy contracts (Fear / Greed / Skeptic)
  const AS = await ethers.getContractFactory("AggregatorStrategy");
  const fear = await AS.deploy(vaultAddr, USDT0, OTHER, ROUTER, oracleAddr, "Fear", { nonce: await freshNonce() });
  await fear.waitForDeployment();
  await sleep(3000);
  const greed = await AS.deploy(vaultAddr, USDT0, OTHER, ROUTER, oracleAddr, "Greed", { nonce: await freshNonce() });
  await greed.waitForDeployment();
  await sleep(3000);
  const skeptic = await AS.deploy(vaultAddr, USDT0, OTHER, ROUTER, oracleAddr, "Skeptic", { nonce: await freshNonce() });
  await skeptic.waitForDeployment();
  await sleep(3000);
  console.log(`Fear:            ${await fear.getAddress()}  (subWallet ${await fear.subWallet()})`);
  console.log(`Greed:           ${await greed.getAddress()}  (subWallet ${await greed.subWallet()})`);
  console.log(`Skeptic:         ${await skeptic.getAddress()}  (subWallet ${await skeptic.subWallet()})`);

  // 4) Slashing + CascadeLedger + WithdrawQueue
  const Slashing = await ethers.getContractFactory("SlashingRegistry");
  const slashing = await Slashing.deploy(
    USDT0,
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

  // 5) Register strategies — small debt limit for mainnet safety
  const DEBT_LIMIT = 5n * 10n ** 6n; // 5 USDT0 per strategy to start
  for (const [label, strat] of [["Fear", fear], ["Greed", greed], ["Skeptic", skeptic]] as const) {
    const tx = await vault.registerStrategy(await strat.getAddress(), DEBT_LIMIT, {
      nonce: await freshNonce(),
    });
    await tx.wait();
    await sleep(3000);
    console.log(`  registered ${label} (debt cap ${Number(DEBT_LIMIT) / 1e6} USDT0)`);
  }

  const out = {
    network: net,
    chainId: 196,
    deployer: deployer.address,
    contracts: {
      USDT0,
      VolatileToken: OTHER,
      OkxRouter: ROUTER,
      FixedPriceSource: priceSourceAddr,
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
    deployedAt: new Date().toISOString(),
    notes:
      "Mainnet deploy uses AggregatorStrategy — trades execute via OKX DEX Aggregator router. " +
      "Agent-runner prepares swap calldata by calling OnchainosClient.getQuote() and submits " +
      "it to the strategy via submitAction((address,uint256,uint256,bytes,uint256)).",
  };
  fs.writeFileSync(path.join(dir, `${net}.atlasV2.json`), JSON.stringify(out, null, 2));
  console.log(`\n✓ written deployments/${net}.atlasV2.json`);
  console.log(`\nNext: seed 1 USDT0 into the vault via admin flow — see scripts/setupAtlasV2.ts`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
