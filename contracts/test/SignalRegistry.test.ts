import { expect } from "chai";
import { ethers } from "hardhat";
import type { SignalRegistry } from "../typechain-types";

describe("SignalRegistry", () => {
  let registry: SignalRegistry;
  let author: Awaited<ReturnType<typeof ethers.getSigners>>[number];
  let other: Awaited<ReturnType<typeof ethers.getSigners>>[number];
  let payer: Awaited<ReturnType<typeof ethers.getSigners>>[number];

  beforeEach(async () => {
    [author, other, payer] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("SignalRegistry");
    registry = (await Factory.deploy()) as unknown as SignalRegistry;
    await registry.waitForDeployment();
  });

  it("exposes VERSION and BPS_DENOMINATOR", async () => {
    expect(await registry.VERSION()).to.equal("0.1.0");
    expect(await registry.BPS_DENOMINATOR()).to.equal(10000n);
  });

  it("registers a signal and indexes it by author", async () => {
    await registry
      .connect(author)
      .register("wallet-risk", "https://signals.beacon.dev/wallet-risk", 1000);

    const id = await registry.signalIdOf(author.address, "wallet-risk");
    const s = await registry.signals(id);
    expect(s.author).to.equal(author.address);
    expect(s.slug).to.equal("wallet-risk");
    expect(s.price).to.equal(1000n);
    expect(await registry.totalSignals()).to.equal(1n);
    expect(await registry.authorSignalCount(author.address)).to.equal(1n);
    expect(await registry.signalIdAt(0)).to.equal(id);
    expect(await registry.authorSignalAt(author.address, 0)).to.equal(id);
  });

  it("rejects duplicate (author, slug)", async () => {
    await registry.connect(author).register("wallet-risk", "https://a", 100);
    await expect(
      registry.connect(author).register("wallet-risk", "https://b", 200)
    ).to.be.revertedWithCustomError(registry, "AlreadyRegistered");
  });

  it("rejects empty slug, oversized slug, empty url", async () => {
    await expect(
      registry.connect(author).register("", "https://a", 0)
    ).to.be.revertedWithCustomError(registry, "BadSlug");
    await expect(
      registry.connect(author).register("a".repeat(65), "https://a", 0)
    ).to.be.revertedWithCustomError(registry, "BadSlug");
    await expect(
      registry.connect(author).register("s", "", 0)
    ).to.be.revertedWithCustomError(registry, "BadUrl");
  });

  it("allows the same slug under different authors", async () => {
    await registry.connect(author).register("shared", "https://a", 100);
    await registry.connect(other).register("shared", "https://b", 200);
    expect(await registry.totalSignals()).to.equal(2n);
  });

  it("lets the author update and retire", async () => {
    await registry.connect(author).register("s", "https://a", 100);
    const id = await registry.signalIdOf(author.address, "s");

    await registry.connect(author).update(id, "https://b", 200);
    let s = await registry.signals(id);
    expect(s.url).to.equal("https://b");
    expect(s.price).to.equal(200n);

    await registry.connect(author).retire(id);
    s = await registry.signals(id);
    expect(s.retired).to.equal(true);

    await expect(
      registry.connect(author).update(id, "https://c", 300)
    ).to.be.revertedWithCustomError(registry, "Retired");
    await expect(registry.connect(author).retire(id)).to.be.revertedWithCustomError(
      registry,
      "Retired"
    );
  });

  it("rejects non-author update and retire", async () => {
    await registry.connect(author).register("s", "https://a", 100);
    const id = await registry.signalIdOf(author.address, "s");
    await expect(
      registry.connect(other).update(id, "https://b", 200)
    ).to.be.revertedWithCustomError(registry, "NotAuthor");
    await expect(registry.connect(other).retire(id)).to.be.revertedWithCustomError(
      registry,
      "NotAuthor"
    );
  });

  describe("composition", () => {
    let b1: string;
    let b2: string;
    let c: string;

    beforeEach(async () => {
      await registry.connect(author).register("base1", "https://1", 100);
      await registry.connect(author).register("base2", "https://2", 100);
      await registry.connect(author).register("composite", "https://c", 300);
      b1 = await registry.signalIdOf(author.address, "base1");
      b2 = await registry.signalIdOf(author.address, "base2");
      c = await registry.signalIdOf(author.address, "composite");
    });

    it("accepts a valid composition and emits", async () => {
      await expect(registry.connect(author).setComposition(c, [b1, b2], [5000, 5000]))
        .to.emit(registry, "CompositionSet")
        .withArgs(c, [b1, b2], [5000, 5000]);
    });

    it("rejects sum > 10000", async () => {
      await expect(
        registry.connect(author).setComposition(c, [b1, b2], [6000, 6000])
      ).to.be.revertedWithCustomError(registry, "BadShares");
    });

    it("rejects self-reference", async () => {
      await expect(
        registry.connect(author).setComposition(c, [b1, c], [5000, 5000])
      ).to.be.revertedWithCustomError(registry, "SelfReference");
    });

    it("rejects unknown upstream", async () => {
      const ghost = ethers.keccak256(ethers.toUtf8Bytes("ghost"));
      await expect(
        registry.connect(author).setComposition(c, [b1, ghost], [5000, 5000])
      ).to.be.revertedWithCustomError(registry, "UpstreamMissing");
    });

    it("rejects retired upstream", async () => {
      await registry.connect(author).retire(b1);
      await expect(
        registry.connect(author).setComposition(c, [b1, b2], [5000, 5000])
      ).to.be.revertedWithCustomError(registry, "UpstreamRetired");
    });
  });

  describe("recordCall", () => {
    let id: string;

    beforeEach(async () => {
      await registry.connect(author).register("s", "https://a", 100);
      id = await registry.signalIdOf(author.address, "s");
    });

    it("accepts author calls and accumulates", async () => {
      const h1 = ethers.keccak256(ethers.toUtf8Bytes("tx1"));
      const h2 = ethers.keccak256(ethers.toUtf8Bytes("tx2"));
      await registry.connect(author).recordCall(id, payer.address, 100, h1);
      await registry.connect(author).recordCall(id, payer.address, 250, h2);

      const s = await registry.signals(id);
      expect(s.callCount).to.equal(2n);
      expect(s.cumulativeRevenue).to.equal(350n);
      expect(await registry.settlementSeen(id, h1)).to.equal(true);
    });

    it("rejects non-author", async () => {
      await expect(
        registry.connect(other).recordCall(id, payer.address, 100, ethers.ZeroHash)
      ).to.be.revertedWithCustomError(registry, "NotAuthor");
    });

    it("rejects duplicate settlement", async () => {
      const h = ethers.keccak256(ethers.toUtf8Bytes("tx"));
      await registry.connect(author).recordCall(id, payer.address, 100, h);
      await expect(
        registry.connect(author).recordCall(id, payer.address, 100, h)
      ).to.be.revertedWithCustomError(registry, "DuplicateSettlement");
    });

    it("rejects zero payer", async () => {
      await expect(
        registry.connect(author).recordCall(id, ethers.ZeroAddress, 100, ethers.ZeroHash)
      ).to.be.revertedWithCustomError(registry, "ZeroPayer");
    });

    it("rejects unknown signal", async () => {
      const ghost = ethers.keccak256(ethers.toUtf8Bytes("ghost"));
      await expect(
        registry.connect(author).recordCall(ghost, payer.address, 100, ethers.ZeroHash)
      ).to.be.revertedWithCustomError(registry, "UnknownSignal");
    });
  });
});
