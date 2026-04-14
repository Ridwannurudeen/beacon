import { BigInt, Bytes } from "@graphprotocol/graph-ts";
import {
  SignalRegistered,
  SignalUpdated,
  SignalRetired,
  CompositionSet,
  CallRecorded,
} from "../generated/SignalRegistry/SignalRegistry";
import { Signal, SignalAuthor, SignalCall } from "../generated/schema";

export function handleSignalRegistered(event: SignalRegistered): void {
  let authorId = Bytes.fromHexString(event.params.author.toHexString());
  let author = SignalAuthor.load(authorId);
  if (!author) {
    author = new SignalAuthor(authorId);
    author.totalCalls = BigInt.zero();
    author.totalRevenue = BigInt.zero();
  }
  author.save();

  let signal = new Signal(event.params.signalId);
  signal.author = authorId;
  signal.slug = event.params.slug;
  signal.url = event.params.url;
  signal.price = event.params.price;
  signal.registeredAt = event.block.timestamp;
  signal.retired = false;
  signal.callCount = BigInt.zero();
  signal.cumulativeRevenue = BigInt.zero();
  signal.save();
}

export function handleSignalUpdated(event: SignalUpdated): void {
  let signal = Signal.load(event.params.signalId);
  if (!signal) return;
  signal.url = event.params.url;
  signal.price = event.params.price;
  signal.save();
}

export function handleSignalRetired(event: SignalRetired): void {
  let signal = Signal.load(event.params.signalId);
  if (!signal) return;
  signal.retired = true;
  signal.save();
}

export function handleCompositionSet(event: CompositionSet): void {
  let signal = Signal.load(event.params.signalId);
  if (!signal) return;
  let upstream: Bytes[] = [];
  for (let i = 0; i < event.params.upstream.length; i++) {
    upstream.push(event.params.upstream[i]);
  }
  let shares: i32[] = [];
  for (let i = 0; i < event.params.shares.length; i++) {
    shares.push(event.params.shares[i]);
  }
  signal.upstream = upstream;
  signal.shares = shares;
  signal.save();
}

export function handleCallRecorded(event: CallRecorded): void {
  let signal = Signal.load(event.params.signalId);
  if (!signal) return;

  signal.callCount = signal.callCount.plus(BigInt.fromI32(1));
  signal.cumulativeRevenue = signal.cumulativeRevenue.plus(event.params.amount);
  signal.save();

  let author = SignalAuthor.load(signal.author);
  if (author) {
    author.totalCalls = author.totalCalls.plus(BigInt.fromI32(1));
    author.totalRevenue = author.totalRevenue.plus(event.params.amount);
    author.save();
  }

  let callId = event.transaction.hash.concatI32(event.logIndex.toI32());
  let call = new SignalCall(callId);
  call.signal = signal.id;
  call.payer = event.params.payer;
  call.amount = event.params.amount;
  call.settlement = event.params.settlement;
  call.blockNumber = event.block.number;
  call.timestamp = event.block.timestamp;
  call.save();
}
