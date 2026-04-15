import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";
async function main() {
  const dep = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments", `${network.name}.json`), "utf-8"));
  const reg = await ethers.getContractAt("SignalRegistry", dep.contracts.SignalRegistry);
  const filter = reg.filters.CallRecorded();
  const latest = await ethers.provider.getBlockNumber();
  // Query in chunks
  const from = 0;
  const events = await reg.queryFilter(filter, from, latest);
  console.log(`CallRecorded events total: ${events.length}`);
  const bySlug: Record<string, number> = {};
  for (const e of events) {
    const id = (e as any).args?.signalId;
    bySlug[id] = (bySlug[id] ?? 0) + 1;
  }
  console.log(JSON.stringify(bySlug, null, 2));
}
main().catch(e => { console.error(e); process.exit(1); });
