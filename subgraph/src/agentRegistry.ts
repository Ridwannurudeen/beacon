import { BigInt } from "@graphprotocol/graph-ts";
import {
  AgentRegistered,
  AgentTraded,
  SignalConsumed,
} from "../generated/AgentRegistry/AgentRegistry";
import { Agent, AgentTrade, AgentSignalCall } from "../generated/schema";

export function handleAgentRegistered(event: AgentRegistered): void {
  let agent = new Agent(event.params.agentId);
  agent.wallet = event.params.wallet;
  agent.name = event.params.name;
  agent.strategy = event.params.strategy;
  agent.startingCapital = event.params.startingCapital;
  agent.registeredAt = event.block.timestamp;
  agent.tradeCount = BigInt.zero();
  agent.signalCount = BigInt.zero();
  agent.cumulativeSignalSpend = BigInt.zero();
  agent.cumulativePnL = BigInt.zero();
  agent.save();
}

export function handleAgentTraded(event: AgentTraded): void {
  let agent = Agent.load(event.params.agentId);
  if (!agent) return;
  agent.tradeCount = agent.tradeCount.plus(BigInt.fromI32(1));
  agent.cumulativePnL = agent.cumulativePnL.plus(event.params.pnlDelta);
  agent.save();

  let id = event.transaction.hash.concatI32(event.logIndex.toI32());
  let trade = new AgentTrade(id);
  trade.agent = agent.id;
  trade.tokenIn = event.params.tokenIn;
  trade.amountIn = event.params.amountIn;
  trade.tokenOut = event.params.tokenOut;
  trade.amountOut = event.params.amountOut;
  trade.pnlDelta = event.params.pnlDelta;
  trade.txHash = event.params.txHash;
  trade.blockNumber = event.block.number;
  trade.timestamp = event.block.timestamp;
  trade.save();
}

export function handleSignalConsumed(event: SignalConsumed): void {
  let agent = Agent.load(event.params.agentId);
  if (!agent) return;
  agent.signalCount = agent.signalCount.plus(BigInt.fromI32(1));
  agent.cumulativeSignalSpend = agent.cumulativeSignalSpend.plus(event.params.cost);
  agent.cumulativePnL = agent.cumulativePnL.minus(event.params.cost);
  agent.save();

  let id = event.transaction.hash.concatI32(event.logIndex.toI32());
  let call = new AgentSignalCall(id);
  call.agent = agent.id;
  call.signalSlug = event.params.signalSlug;
  call.cost = event.params.cost;
  call.settlementTx = event.params.settlementTx;
  call.blockNumber = event.block.number;
  call.timestamp = event.block.timestamp;
  call.save();
}
