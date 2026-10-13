import test from "node:test";
import assert from "node:assert/strict";
import { zeroAddress } from "viem";
import { recoverPostReceipt } from "./postRecovery";
import { gameRpc } from "./gameChain";
import { verifySocialReceipt } from "./socialChain";

const wallet = `0x${"11".repeat(20)}`;
const hash = `0x${"ab".repeat(32)}`;
const uri = "mf:98:original-commitment";
function fixture() {
  let verifications = 0;
  const ranges: [bigint, bigint][] = [];
  const client = {
    getBlockNumber: async () => 10_000n,
    readContract: async () => wallet,
    getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({ timestamp: blockNumber }),
    getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
      ranges.push([fromBlock, toBlock]);
      assert.ok(toBlock - fromBlock < 100n);
      return fromBlock <= 8010n && toBlock >= 8010n ?
        [{ removed: false, transactionHash: hash, args: { contentUri: uri } }] : [];
    },
  };
  const verify = async () => { verifications++; };
  return { client, verify, ranges, verified: () => verifications };
}
const preparedAt = new Date(8_000_000);
test("recovers original receipt using headers and 100-block log pages, then verifies it", async () => {
  const f = fixture();
  const result = await recoverPostReceipt(98, wallet, uri, f.client as unknown as typeof gameRpc, f.verify as typeof verifySocialReceipt, preparedAt);
  assert.deepEqual(result, { anchored: true, txHash: hash });
  assert.equal(f.verified(), 1);
  assert.ok(f.ranges.length <= 4);
});
test("unanchored drafts return no hash without searching logs", async () => {
  const f = fixture(); f.client.readContract = async () => zeroAddress;
  assert.deepEqual(await recoverPostReceipt(98, wallet, uri, f.client as unknown as typeof gameRpc, f.verify as typeof verifySocialReceipt, preparedAt), { anchored: false, txHash: null });
  assert.equal(f.ranges.length, 0); assert.equal(f.verified(), 0);
});
test("wrong author, mismatched commitment and RPC outages fail closed", async () => {
  const f = fixture();
  await assert.rejects(recoverPostReceipt(98, zeroAddress, uri, f.client as unknown as typeof gameRpc, f.verify as typeof verifySocialReceipt, preparedAt), /another wallet/);
  await assert.rejects(recoverPostReceipt(98, wallet, "wrong", f.client as unknown as typeof gameRpc, f.verify as typeof verifySocialReceipt, preparedAt), /does not match/);
  f.client.getBlock = async () => { throw new Error("RPC offline"); };
  await assert.rejects(recoverPostReceipt(98, wallet, uri, f.client as unknown as typeof gameRpc, f.verify as typeof verifySocialReceipt, preparedAt), /RPC offline/);
  assert.equal(f.verified(), 0);
});
test("receipt verification failure never becomes publication success", async () => {
  const f = fixture();
  await assert.rejects(recoverPostReceipt(98, wallet, uri, f.client as unknown as typeof gameRpc, (async () => { throw new Error("bad canonical receipt"); }) as typeof verifySocialReceipt, preparedAt), /bad canonical receipt/);
});
test("late receipts outside automatic window stop rather than authorizing another transaction", async () => {
  const f = fixture(); f.client.getLogs = async () => [];
  await assert.rejects(recoverPostReceipt(98, wallet, uri, f.client as unknown as typeof gameRpc, f.verify as typeof verifySocialReceipt, new Date(100_000)), /outside/);
  assert.equal(f.verified(), 0);
});
test("recovers a delayed confirmation in the recent window", async () => {
  const f = fixture();
  f.client.getBlockNumber = async () => 20_000n;
  f.client.getLogs = async ({ fromBlock, toBlock }) => {
    assert.ok(toBlock - fromBlock < 100n);
    return fromBlock <= 19_950n && toBlock >= 19_950n
      ? [{ removed: false, transactionHash: hash, args: { contentUri: uri } }] : [];
  };
  assert.deepEqual(await recoverPostReceipt(98, wallet, uri, f.client as unknown as typeof gameRpc,
    f.verify as typeof verifySocialReceipt, preparedAt), { anchored: true, txHash: hash });
  assert.equal(f.verified(), 1);
});
test("historical record uses its original date and exact legacy URI, not the new draft commitment", async () => {
  const f = fixture();
  const legacyUri = "mf:98:/objects/uploads/original";
  f.client.getBlockNumber = async () => 30_000n;
  f.client.getLogs = async ({ fromBlock, toBlock }) => {
    assert.ok(toBlock - fromBlock < 100n);
    return fromBlock <= 8010n && toBlock >= 8010n
      ? [{ removed: false, transactionHash: hash, args: { contentUri: legacyUri } }] : [];
  };
  const verifiedUris: (string | undefined)[] = [];
  const verify = (async (_kind, _hash, _wallet, _id, verifiedUri) => { verifiedUris.push(verifiedUri); }) as typeof verifySocialReceipt;
  assert.deepEqual(await recoverPostReceipt(98, wallet, uri, f.client as unknown as typeof gameRpc,
    verify, new Date(20_000_000), legacyUri, preparedAt), { anchored: true, txHash: hash });
  assert.deepEqual(verifiedUris, [legacyUri]);
});
test("historical recovery also searches the later draft window for a newly signed commitment", async () => {
  const f = fixture();
  f.client.getBlockNumber = async () => 30_000n;
  f.client.getLogs = async ({ fromBlock, toBlock }) => {
    assert.ok(toBlock - fromBlock < 100n);
    return fromBlock <= 20_010n && toBlock >= 20_010n
      ? [{ removed: false, transactionHash: hash, args: { contentUri: uri } }] : [];
  };
  assert.deepEqual(await recoverPostReceipt(98, wallet, uri, f.client as unknown as typeof gameRpc,
    f.verify as typeof verifySocialReceipt, new Date(20_000_000), "mf:98:/objects/uploads/original", preparedAt),
    { anchored: true, txHash: hash });
  assert.equal(f.verified(), 1);
});
test("a legacy URI without server approval or for a different image is rejected", async () => {
  const f = fixture();
  f.client.getLogs = async () => [{ removed: false, transactionHash: hash, args: { contentUri: "mf:98:/objects/uploads/unrelated" } }];
  await assert.rejects(recoverPostReceipt(98, wallet, uri, f.client as unknown as typeof gameRpc,
    f.verify as typeof verifySocialReceipt, preparedAt, "mf:98:/objects/uploads/original"), /does not match/);
  assert.equal(f.verified(), 0);
});
