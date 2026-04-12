import { expect } from "chai";
import { ethers } from "hardhat";
import type { PaymentSplitter, MockERC20 } from "../typechain-types";

describe("PaymentSplitter", () => {
  let splitter: PaymentSplitter;
  let token: MockERC20;
  let composite: Awaited<ReturnType<typeof ethers.getSigners>>[number];
  let up1: Awaited<ReturnType<typeof ethers.getSigners>>[number];
  let up2: Awaited<ReturnType<typeof ethers.getSigners>>[number];

  beforeEach(async () => {
    [composite, up1, up2] = await ethers.getSigners();

    const MockToken = await ethers.getContractFactory("MockERC20");
    token = (await MockToken.deploy("Mock USDT", "USDT")) as unknown as MockERC20;
    await token.waitForDeployment();
    await token.mint(composite.address, ethers.parseUnits("1000", 6));

    const Splitter = await ethers.getContractFactory("PaymentSplitter");
    splitter = (await Splitter.deploy()) as unknown as PaymentSplitter;
    await splitter.waitForDeployment();

    await token.connect(composite).approve(await splitter.getAddress(), ethers.MaxUint256);
  });

  it("exposes VERSION and BPS_DENOMINATOR", async () => {
    expect(await splitter.VERSION()).to.equal("0.1.0");
    expect(await splitter.BPS_DENOMINATOR()).to.equal(10000n);
  });

  it("splits across upstreams and credits margin to composite", async () => {
    const signalId = ethers.keccak256(ethers.toUtf8Bytes("composite"));
    const amount = 1_000_000n;
    const tokenAddr = await token.getAddress();

    await splitter
      .connect(composite)
      .distribute(signalId, tokenAddr, amount, [up1.address, up2.address], [4000, 3000]);

    expect(await splitter.balanceOf(up1.address, tokenAddr)).to.equal(400_000n);
    expect(await splitter.balanceOf(up2.address, tokenAddr)).to.equal(300_000n);
    expect(await splitter.balanceOf(composite.address, tokenAddr)).to.equal(300_000n);
    expect(await splitter.distributedBy(composite.address, tokenAddr)).to.equal(amount);
  });

  it("distributes full amount when shares sum to 10000", async () => {
    const tokenAddr = await token.getAddress();
    await splitter
      .connect(composite)
      .distribute(
        ethers.ZeroHash,
        tokenAddr,
        1_000_000n,
        [up1.address, up2.address],
        [6000, 4000]
      );
    expect(await splitter.balanceOf(up1.address, tokenAddr)).to.equal(600_000n);
    expect(await splitter.balanceOf(up2.address, tokenAddr)).to.equal(400_000n);
    expect(await splitter.balanceOf(composite.address, tokenAddr)).to.equal(0n);
  });

  it("lets recipients claim their balances", async () => {
    const tokenAddr = await token.getAddress();
    await splitter
      .connect(composite)
      .distribute(ethers.ZeroHash, tokenAddr, 1_000_000n, [up1.address], [10000]);

    const before = await token.balanceOf(up1.address);
    await splitter.connect(up1).claim(tokenAddr);
    const after = await token.balanceOf(up1.address);
    expect(after - before).to.equal(1_000_000n);
    expect(await splitter.balanceOf(up1.address, tokenAddr)).to.equal(0n);
  });

  it("rejects claim with zero balance", async () => {
    await expect(splitter.connect(up1).claim(await token.getAddress()))
      .to.be.revertedWithCustomError(splitter, "NothingToClaim");
  });

  it("rejects mismatched arrays, zero amount, zero recipient, bad shares", async () => {
    const tokenAddr = await token.getAddress();
    await expect(
      splitter
        .connect(composite)
        .distribute(ethers.ZeroHash, tokenAddr, 1_000_000n, [up1.address], [5000, 5000])
    ).to.be.revertedWithCustomError(splitter, "LengthMismatch");

    await expect(
      splitter
        .connect(composite)
        .distribute(ethers.ZeroHash, tokenAddr, 0, [up1.address], [5000])
    ).to.be.revertedWithCustomError(splitter, "ZeroAmount");

    await expect(
      splitter
        .connect(composite)
        .distribute(ethers.ZeroHash, tokenAddr, 1_000_000n, [ethers.ZeroAddress], [5000])
    ).to.be.revertedWithCustomError(splitter, "ZeroRecipient");

    await expect(
      splitter
        .connect(composite)
        .distribute(ethers.ZeroHash, tokenAddr, 1_000_000n, [up1.address], [11000])
    ).to.be.revertedWithCustomError(splitter, "BadShares");
  });
});
