import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeFunctionData, encodeEventTopics, encodeAbiParameters, parseAbi, parseAbiParameters, parseEther } from "viem";
import { validateSubscriptionReceipt } from "../routes/subscriptions.ts";
import { REGISTRY } from "./chainConfig.ts";

const abi = parseAbi([
  "function subscribe(address creator) payable",
  "event Subscribed(address indexed subscriber, address indexed creator, uint256 priceWei, uint256 expiresAt)",
]);
const subscriber = `0x${"11".repeat(20)}`, creator = `0x${"22".repeat(20)}`;
const hash = `0x${"aa".repeat(32)}`, blockHash = `0x${"bb".repeat(32)}`;
const timestamp = BigInt(Math.floor(Date.now() / 1000));
function fixture() {
  return {
    tx: { hash, blockHash, chainId: 143, from: subscriber, to: REGISTRY, value: parseEther("2"),
      input: encodeFunctionData({ abi, functionName: "subscribe", args: [creator] }) },
    receipt: { transactionHash: hash, blockHash, from: subscriber, to: REGISTRY, status: "success", logs: [{
      address: REGISTRY,
      topics: encodeEventTopics({ abi, eventName: "Subscribed", args: { subscriber, creator } }),
      data: encodeAbiParameters(parseAbiParameters("uint256,uint256"), [parseEther("2"), timestamp + 30n * 86400n]),
    }] },
    quote: { createdAt: new Date(Number(timestamp - 10n) * 1000), expiresAt: new Date(Number(timestamp + 10n) * 1000) },
  };
}
function verify(f, price = "2", who = subscriber, to = creator, time = timestamp) {
  return validateSubscriptionReceipt(f.tx, f.receipt, time, hash, who, to, price, f.quote);
}
test("quoted price remains valid regardless of later listing price; recovery uses mining time", () => {
  assert.ok(verify(fixture()));
  assert.equal(verify(fixture(), "3"), null);
});
test("quote boundaries reject before issuance and after expiry", () => {
  const f = fixture();
  f.quote.createdAt = new Date(Number(timestamp + 1n) * 1000);
  assert.equal(verify(f), null);
  f.quote.createdAt = new Date(Number(timestamp - 20n) * 1000);
  f.quote.expiresAt = new Date(Number(timestamp - 1n) * 1000);
  assert.equal(verify(f), null);
});
test("wrong wallet, creator, price, chain, destination, reverted receipt and replay identity fail closed", () => {
  assert.equal(verify(fixture(), "2", creator), null);
  assert.equal(verify(fixture(), "2", subscriber, subscriber), null);
  for (const [field, value] of [["chainId", 1], ["to", creator], ["value", 0n], ["hash", blockHash], ["blockHash", hash], ["input", "0x"]]) {
    const f = fixture(); f.tx[field] = value;
    assert.equal(verify(f), null, field);
  }
  const f = fixture(); f.receipt.status = "reverted"; assert.equal(verify(f), null);
  const g = fixture(); g.receipt.logs = []; assert.equal(verify(g), null);
});