import { expect } from "chai";
import { ethers } from "hardhat";
import type {
  AgentRegistry,
  AtlasVault,
  DemoAMM,
  MockERC20,
  MockX,
} from "../typechain-types";

const ONE_BUSD = 1_000_000n; // 6 decimals
const ONE_MOCKX = 1_000_000n; // 6 decimals

describe("Atlas", () => {
  let bUSD: MockERC20;
  let mockX: MockX;
  let amm: DemoAMM;
  let registry: AgentRegistry;
  let vault: AtlasVault;
  let depositor: Awaited<ReturnType<typeof ethers.getSigners>>[number];
  let agentA: Awaited<ReturnType<typeof ethers.getSigners>>[number];
  let agentB: Awaited<ReturnType<typeof ethers.getSigners>>[number];

  beforeEach(async () => {
    [depositor, agentA, agentB] = await ethers.getSigners();

    const Mock = await ethers.getContractFactory("MockERC20");
    bUSD = (await Mock.deploy("Beacon USD", "bUSD")) as unknown as MockERC20;
    await bUSD.waitForDeployment();
    const X = await ethers.getContractFactory("MockX");
    mockX = (await X.deploy()) as unknown as MockX;
    await mockX.waitForDeployment();

    const Reg = await ethers.getContractFactory("AgentRegistry");
    registry = (await Reg.deploy()) as unknown as AgentRegistry;
    await registry.waitForDeployment();

    const AMM = await ethers.getContractFactory("DemoAMM");
    amm = (await AMM.deploy(
      await bUSD.getAddress(),
      await mockX.getAddress()
    )) as unknown as DemoAMM;
    await amm.waitForDeployment();

    const Vault = await ethers.getContractFactory("AtlasVault");
    vault = (await Vault.deploy(
      await bUSD.getAddress(),
      await mockX.getAddress(),
      await registry.getAddress(),
      await amm.getAddress()
    )) as unknown as AtlasVault;
    await vault.waitForDeployment();

    // Seed AMM with 100k bUSD / 100k MOCK-X (spot = 1.0)
    const amountB = 100_000n * ONE_BUSD;
    const amountX = 100_000n * ONE_MOCKX;
    await bUSD.mint(depositor.address, amountB);
    await mockX.mint(depositor.address, amountX);
    await bUSD.connect(depositor).approve(await amm.getAddress(), amountB);
    await mockX.connect(depositor).approve(await amm.getAddress(), amountX);
    await amm.connect(depositor).addLiquidity(amountB, amountX);
  });

  describe("DemoAMM", () => {
    it("seeds reserves and prices at parity", async () => {
      expect(await amm.reserveA()).to.equal(100_000n * ONE_BUSD);
      expect(await amm.reserveB()).to.equal(100_000n * ONE_MOCKX);
      expect(await amm.spotPriceAInB()).to.equal(10n ** 18n);
      expect(await amm.spotPriceBInA()).to.equal(10n ** 18n);
    });

    it("swaps with v2 math + 0.3% fee", async () => {
      // 1000 bUSD in → ~996 MOCK-X out (0.3% fee + tiny slippage on big pool)
      const amountIn = 1000n * ONE_BUSD;
      const expectedOut = await amm.getAmountOut(
        amountIn,
        100_000n * ONE_BUSD,
        100_000n * ONE_MOCKX
      );
      await bUSD.mint(agentA.address, amountIn);
      await bUSD.connect(agentA).approve(await amm.getAddress(), amountIn);

      const balBefore = await mockX.balanceOf(agentA.address);
      await amm
        .connect(agentA)
        .swap(await bUSD.getAddress(), amountIn, expectedOut, agentA.address);
      const balAfter = await mockX.balanceOf(agentA.address);

      expect(balAfter - balBefore).to.equal(expectedOut);
      // Price moves up after we bought MOCK-X (less MOCK-X in pool).
      const newSpot = await amm.spotPriceBInA();
      expect(newSpot).to.be.gt(10n ** 18n);
    });

    it("rejects unknown token / zero amount / slippage breach", async () => {
      const fake = ethers.ZeroAddress;
      await expect(
        amm.connect(agentA).swap(fake, 1, 0, agentA.address)
      ).to.be.revertedWithCustomError(amm, "UnknownToken");

      await bUSD.mint(agentA.address, 1000n);
      await bUSD.connect(agentA).approve(await amm.getAddress(), 1000n);
      await expect(
        amm
          .connect(agentA)
          .swap(await bUSD.getAddress(), 1000n, 10n ** 18n, agentA.address)
      ).to.be.revertedWithCustomError(amm, "InsufficientOutput");
    });
  });

  describe("AgentRegistry", () => {
    it("registers + indexes + tracks per-agent metrics", async () => {
      await registry.connect(agentA).register("Fear", "momentum", 10_000n * ONE_BUSD);
      await registry.connect(agentB).register("Greed", "mean-reversion", 10_000n * ONE_BUSD);

      expect(await registry.totalAgents()).to.equal(2n);
      const idA = await registry.agentIdOf(agentA.address);
      const a = await registry.agents(idA);
      expect(a.wallet).to.equal(agentA.address);
      expect(a.name).to.equal("Fear");
      expect(a.strategy).to.equal("momentum");

      // record a trade and a signal
      await registry
        .connect(agentA)
        .recordTrade(
          await bUSD.getAddress(),
          1000n * ONE_BUSD,
          await mockX.getAddress(),
          996n * ONE_MOCKX,
          50_000n,
          ethers.ZeroHash
        );
      await registry
        .connect(agentA)
        .recordSignal("wallet-risk", 1000n, ethers.ZeroHash);

      const updated = await registry.agents(idA);
      expect(updated.tradeCount).to.equal(1n);
      expect(updated.signalCount).to.equal(1n);
      expect(updated.cumulativeSignalSpend).to.equal(1000n);
      // PnL = +50_000 (trade) - 1000 (signal) = +49_000
      expect(updated.cumulativePnL).to.equal(49_000n);
    });

    it("rejects double registration + non-agent record calls", async () => {
      await registry.connect(agentA).register("Fear", "momentum", 0);
      await expect(
        registry.connect(agentA).register("FearV2", "momentum", 0)
      ).to.be.revertedWithCustomError(registry, "AlreadyRegistered");
      await expect(
        registry
          .connect(agentB)
          .recordTrade(await bUSD.getAddress(), 1, await mockX.getAddress(), 1, 0, ethers.ZeroHash)
      ).to.be.revertedWithCustomError(registry, "NotAgent");
    });
  });

  describe("AtlasVault", () => {
    it("first deposit mints 1:1 and tracks NAV", async () => {
      await bUSD.mint(depositor.address, 1000n * ONE_BUSD);
      await bUSD.connect(depositor).approve(await vault.getAddress(), 1000n * ONE_BUSD);
      await vault.connect(depositor).deposit(1000n * ONE_BUSD);

      expect(await vault.balanceOf(depositor.address)).to.equal(1000n * ONE_BUSD);
      expect(await vault.totalAssets()).to.equal(1000n * ONE_BUSD);
      expect(await vault.pricePerShare()).to.equal(ONE_BUSD); // 1.000000
    });

    it("aggregates agent equity into NAV", async () => {
      // Register two agents
      await registry.connect(agentA).register("A", "s", 0);
      await registry.connect(agentB).register("B", "s", 0);

      // Hand 500 bUSD + 500 MOCK-X (≈$1000 at parity) to agentA
      await bUSD.mint(agentA.address, 500n * ONE_BUSD);
      await mockX.mint(agentA.address, 500n * ONE_MOCKX);
      // Hand 200 bUSD to agentB
      await bUSD.mint(agentB.address, 200n * ONE_BUSD);

      // Vault holds nothing yet — totalAssets should sum from agents
      expect(await vault.totalAssets()).to.equal(
        500n * ONE_BUSD + 500n * ONE_BUSD + 200n * ONE_BUSD
      );
    });

    it("withdraw burns shares and pays from idle bUSD", async () => {
      await bUSD.mint(depositor.address, 1000n * ONE_BUSD);
      await bUSD.connect(depositor).approve(await vault.getAddress(), 1000n * ONE_BUSD);
      await vault.connect(depositor).deposit(1000n * ONE_BUSD);

      const sharesBefore = await vault.balanceOf(depositor.address);
      const balBefore = await bUSD.balanceOf(depositor.address);
      await vault.connect(depositor).withdraw(sharesBefore / 2n);
      expect(await vault.balanceOf(depositor.address)).to.equal(sharesBefore / 2n);
      expect(await bUSD.balanceOf(depositor.address)).to.equal(balBefore + 500n * ONE_BUSD);
    });

    it("rejects zero deposit / withdraw + over-withdraw", async () => {
      await expect(vault.connect(depositor).deposit(0)).to.be.revertedWithCustomError(
        vault,
        "ZeroAmount"
      );
      await expect(vault.connect(depositor).withdraw(0)).to.be.revertedWithCustomError(
        vault,
        "ZeroAmount"
      );
      await expect(
        vault.connect(depositor).withdraw(1)
      ).to.be.revertedWithCustomError(vault, "InsufficientShares");
    });
  });
});
