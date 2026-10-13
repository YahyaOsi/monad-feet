import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, parseAbiParameters } from "viem";
import { socialAbi, verifySocialReceipt, postCommitment } from "./socialChain";
import { REGISTRY, CHAIN_ID } from "./chainConfig";
import { gameRpc } from "./gameChain";

const wallet = "0x1111111111111111111111111111111111111111";
const other = "0x2222222222222222222222222222222222222222";
const relay = "0x3333333333333333333333333333333333333333";
const hash = `0x${"ab".repeat(32)}` as const;
const blockHash = `0x${"cd".repeat(32)}` as const;
const uri = postCommitment(75, wallet, "caption", "/api/storage/objects/image", false);
function fixture(kind: "post" | "like" = "post") {
  const tx = { hash, blockHash, blockNumber: 100n, chainId: CHAIN_ID, from: wallet, to: REGISTRY, value: 0n,
    input: kind === "post"
      ? encodeFunctionData({ abi: socialAbi, functionName: "createPost", args: [75n, uri] })
      : encodeFunctionData({ abi: socialAbi, functionName: "likePost", args: [75n] }) };
  const log = { address: REGISTRY, removed: false,
    topics: kind === "post"
      ? encodeEventTopics({ abi: socialAbi, eventName: "PostCreated", args: { author: wallet, postId: 75n } })
      : encodeEventTopics({ abi: socialAbi, eventName: "PostLiked", args: { liker: wallet, postId: 75n } }),
    data: kind === "post" ? encodeAbiParameters(parseAbiParameters("string,uint256"), [uri, 123n])
      : encodeAbiParameters(parseAbiParameters("uint256"), [123n]) };
  const receipt = { status: "success", transactionHash: hash, blockHash, blockNumber: 100n,
    from: wallet, to: REGISTRY, logs: [log] };
  const block = { hash: blockHash, timestamp: 123n };
  let author = wallet, liked = true, trace: unknown = null;
  const client = {
    getTransactionReceipt: async () => receipt,
    getTransaction: async () => tx,
    getBlock: async () => block,
    readContract: async ({ functionName }: { functionName: string }) => functionName === "postAuthor" ? author : liked,
    request: async () => trace,
  } as unknown as typeof gameRpc;
  return { tx, receipt, block, client, setAuthor: (v: string) => { author = v; },
    setLiked: (v: boolean) => { liked = v; }, setTrace: (v: unknown) => { trace = v; } };
}
const verifiedDeployment = async () => {};
test("publication commitment changes for caption, image, visibility and wallet", () => {
  for (const alternative of [
    postCommitment(75, wallet, "changed", "/api/storage/objects/image", false),
    postCommitment(75, wallet, "caption", "/api/storage/objects/other", false),
    postCommitment(75, wallet, "caption", "/api/storage/objects/image", true),
    postCommitment(75, other, "caption", "/api/storage/objects/image", false),
  ]) assert.notEqual(uri, alternative);
});
test("matching successful direct publication and like receipts pass", async () => {
  for (const kind of ["post", "like"] as const) {
    const f = fixture(kind);
    await verifySocialReceipt(kind, hash, wallet, 75, uri, f.client, verifiedDeployment);
  }
});
test("receipt verification rejects wrong chain, failed status, changed block and wrong calldata", async () => {
  const mutations = [
    (f: ReturnType<typeof fixture>) => { f.tx.chainId = 1; },
    (f: ReturnType<typeof fixture>) => { f.receipt.status = "reverted"; },
    (f: ReturnType<typeof fixture>) => { f.block.timestamp = 124n; },
    (f: ReturnType<typeof fixture>) => { f.tx.blockNumber = 99n; },
    (f: ReturnType<typeof fixture>) => { f.tx.input = encodeFunctionData({ abi: socialAbi, functionName: "createPost", args: [76n, uri] }); },
    (f: ReturnType<typeof fixture>) => { f.tx.input = encodeFunctionData({ abi: socialAbi, functionName: "createPost", args: [75n, "tampered"] }); },
    (f: ReturnType<typeof fixture>) => { f.setAuthor(other); },
    (f: ReturnType<typeof fixture>) => { f.receipt.logs.push(f.receipt.logs[0]); },
    (f: ReturnType<typeof fixture>) => { f.receipt.logs[0].removed = true; },
  ];
  for (const mutate of mutations) {
    const f = fixture(); mutate(f);
    await assert.rejects(verifySocialReceipt("post", hash, wallet, 75, uri, f.client, verifiedDeployment));
  }
});
test("a successful event alone cannot authorize a different signer or an unrecorded like", async () => {
  const f = fixture(); f.tx.from = other; f.receipt.from = other;
  await assert.rejects(verifySocialReceipt("post", hash, wallet, 75, uri, f.client, verifiedDeployment));
  const like = fixture("like"); like.setLiked(false);
  await assert.rejects(verifySocialReceipt("like", hash, wallet, 75, uri, like.client, verifiedDeployment));
});
test("relayed publication requires a verified successful inner wallet CALL", async () => {
  const f = fixture();
  const innerInput = f.tx.input;
  f.tx.from = relay; f.receipt.from = relay;
  f.tx.to = other as typeof REGISTRY; f.receipt.to = other as typeof REGISTRY;
  f.tx.input = "0x1234";
  const trace = { type: "CALL", from: relay, to: other, value: "0x0", input: f.tx.input,
    calls: [{ type: "CALL", from: wallet, to: REGISTRY, value: "0x0", input: innerInput }] };
  f.setTrace(trace);
  await verifySocialReceipt("post", hash, wallet, 75, uri, f.client, verifiedDeployment);
  f.setTrace({ ...trace, calls: [{ ...trace.calls[0], from: other }] });
  await assert.rejects(verifySocialReceipt("post", hash, wallet, 75, uri, f.client, verifiedDeployment));
  f.setTrace({ ...trace, error: "reverted" });
  await assert.rejects(verifySocialReceipt("post", hash, wallet, 75, uri, f.client, verifiedDeployment));
});
