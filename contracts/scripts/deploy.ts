import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("no deployer signer — set PRIVATE_KEY in .env");
  console.log(`Deploying to ${network.name} (chainId ${network.config.chainId}) from ${deployer.address}`);

  const Registry = await ethers.getContractFactory("SignalRegistry");
  const registry = await Registry.deploy();
  await registry.waitForDeployment();
  const registryAddr = await registry.getAddress();
  console.log(`SignalRegistry:   ${registryAddr}`);

  const Splitter = await ethers.getContractFactory("PaymentSplitter");
  const splitter = await Splitter.deploy();
  await splitter.waitForDeployment();
  const splitterAddr = await splitter.getAddress();
  console.log(`PaymentSplitter:  ${splitterAddr}`);

  const out = {
    network: network.name,
    chainId: network.config.chainId,
    deployer: deployer.address,
    contracts: {
      SignalRegistry: registryAddr,
      PaymentSplitter: splitterAddr,
    },
    deployedAt: new Date().toISOString(),
  };

  const outDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, `${network.name}.json`),
    JSON.stringify(out, null, 2)
  );
  console.log(`Written deployments/${network.name}.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
