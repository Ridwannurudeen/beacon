import { BigInt, Bytes } from "@graphprotocol/graph-ts";
import {
  Deposit,
  Withdraw,
  CapitalAllocated,
  CapitalReturned,
  Harvested,
  StrategyRegistered,
} from "../generated/AtlasVaultV2/AtlasVaultV2";
import {
  Vault,
  VaultDeposit,
  VaultWithdraw,
  StrategyState,
  Harvest,
} from "../generated/schema";

const VAULT_ADDRESS = Bytes.fromHexString("0x2b77AAD51566aeD6ec6feba250450200997BbA22");

function loadOrCreateVault(): Vault {
  let v = Vault.load(VAULT_ADDRESS);
  if (!v) {
    v = new Vault(VAULT_ADDRESS);
    v.totalDeposits = BigInt.zero();
    v.totalWithdraws = BigInt.zero();
    v.totalAllocated = BigInt.zero();
    v.totalReturned = BigInt.zero();
    v.totalProfit = BigInt.zero();
    v.totalLoss = BigInt.zero();
  }
  return v as Vault;
}

export function handleStrategyRegistered(event: StrategyRegistered): void {
  let v = loadOrCreateVault();
  v.save();

  let id = Bytes.fromHexString(event.params.strategy.toHexString());
  let s = StrategyState.load(id);
  if (!s) {
    s = new StrategyState(id);
    s.vault = v.id;
    s.currentDebt = BigInt.zero();
    s.cumulativeProfit = BigInt.zero();
    s.cumulativeLoss = BigInt.zero();
  }
  s.debtLimit = event.params.debtLimit;
  s.save();
}

export function handleDeposit(event: Deposit): void {
  let v = loadOrCreateVault();
  v.totalDeposits = v.totalDeposits.plus(event.params.assets);
  v.save();

  let id = event.transaction.hash.concatI32(event.logIndex.toI32());
  let d = new VaultDeposit(id);
  d.vault = v.id;
  d.sender = event.params.sender;
  d.receiver = event.params.owner;
  d.assets = event.params.assets;
  d.shares = event.params.shares;
  d.blockNumber = event.block.number;
  d.timestamp = event.block.timestamp;
  d.save();
}

export function handleWithdraw(event: Withdraw): void {
  let v = loadOrCreateVault();
  v.totalWithdraws = v.totalWithdraws.plus(event.params.assets);
  v.save();

  let id = event.transaction.hash.concatI32(event.logIndex.toI32());
  let w = new VaultWithdraw(id);
  w.vault = v.id;
  w.sender = event.params.sender;
  w.receiver = event.params.receiver;
  w.owner = event.params.owner;
  w.assets = event.params.assets;
  w.shares = event.params.shares;
  w.blockNumber = event.block.number;
  w.timestamp = event.block.timestamp;
  w.save();
}

export function handleAllocate(event: CapitalAllocated): void {
  let v = loadOrCreateVault();
  v.totalAllocated = v.totalAllocated.plus(event.params.amount);
  v.save();
  let id = Bytes.fromHexString(event.params.strategy.toHexString());
  let s = StrategyState.load(id);
  if (!s) return;
  s.currentDebt = s.currentDebt.plus(event.params.amount);
  s.save();
}

export function handleReturn(event: CapitalReturned): void {
  let v = loadOrCreateVault();
  v.totalReturned = v.totalReturned.plus(event.params.amount);
  v.save();
  let id = Bytes.fromHexString(event.params.strategy.toHexString());
  let s = StrategyState.load(id);
  if (!s) return;
  s.currentDebt = s.currentDebt.gt(event.params.amount)
    ? s.currentDebt.minus(event.params.amount)
    : BigInt.zero();
  s.save();
}

export function handleHarvest(event: Harvested): void {
  let v = loadOrCreateVault();
  v.totalProfit = v.totalProfit.plus(event.params.profit);
  v.totalLoss = v.totalLoss.plus(event.params.loss);
  v.save();

  let sid = Bytes.fromHexString(event.params.strategy.toHexString());
  let s = StrategyState.load(sid);
  if (s) {
    s.cumulativeProfit = s.cumulativeProfit.plus(event.params.profit);
    s.cumulativeLoss = s.cumulativeLoss.plus(event.params.loss);
    s.lastHarvestBlock = event.block.number;
    s.save();
  }

  let id = event.transaction.hash.concatI32(event.logIndex.toI32());
  let h = new Harvest(id);
  h.vault = v.id;
  h.strategy = sid;
  h.profit = event.params.profit;
  h.loss = event.params.loss;
  h.blockNumber = event.block.number;
  h.timestamp = event.block.timestamp;
  h.save();
}
