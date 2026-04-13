import { parseAbi } from "viem";

export const ERC20_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function approve(address, uint256) returns (bool)",
  "function allowance(address, address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function transfer(address, uint256) returns (bool)",
]);

export const AMM_ABI = parseAbi([
  "function reserveA() view returns (uint256)",
  "function reserveB() view returns (uint256)",
  "function spotPriceAInB() view returns (uint256)",
  "function spotPriceBInA() view returns (uint256)",
  "function getAmountOut(uint256, uint256, uint256) pure returns (uint256)",
  "function swap(address tokenIn, uint256 amountIn, uint256 minOut, address to) returns (uint256)",
  "event Swap(address indexed sender, address indexed tokenIn, uint256 amountIn, address indexed tokenOut, uint256 amountOut, address to)",
]);

export const REGISTRY_ABI = parseAbi([
  "function register(string name, string strategy, uint256 startingCapital) returns (bytes32)",
  "function recordTrade(address tokenIn, uint256 amountIn, address tokenOut, uint256 amountOut, int256 pnlDelta, bytes32 txHash)",
  "function recordSignal(string signalSlug, uint256 cost, bytes32 settlementTx)",
  "function agentIdOf(address) pure returns (bytes32)",
  "function agents(bytes32) view returns (address wallet, string name, string strategy, uint256 startingCapital, uint64 registeredAt, uint256 tradeCount, uint256 signalCount, uint256 cumulativeSignalSpend, int256 cumulativePnL)",
]);
