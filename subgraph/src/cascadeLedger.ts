import { BigInt } from "@graphprotocol/graph-ts";
import {
  CascadeSettled,
  UpstreamPaid,
} from "../generated/CascadeLedger/CascadeLedger";
import { Cascade, UpstreamPayment } from "../generated/schema";

export function handleCascadeSettled(event: CascadeSettled): void {
  let c = new Cascade(event.params.receiptId);
  c.composite = event.params.composite;
  c.buyer = event.params.buyer;
  c.buyerAmount = event.params.buyerAmount;
  c.settlementToken = event.params.settlementToken;
  c.buyerSettlementTx = event.params.buyerSettlementTx;
  c.timestamp = event.params.timestamp;
  c.blockNumber = event.block.number;
  c.save();
}

export function handleUpstreamPaid(event: UpstreamPaid): void {
  let id = event.params.receiptId.concatI32(event.params.index.toI32());
  let up = new UpstreamPayment(id);
  up.cascade = event.params.receiptId;
  up.index = event.params.index;
  up.slug = event.params.slug;
  up.author = event.params.author;
  up.amount = event.params.amount;
  up.settlementTx = event.params.settlementTx;
  up.save();
}
