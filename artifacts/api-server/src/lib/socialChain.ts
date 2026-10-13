import { decodeEventLog, decodeFunctionData, keccak256, parseAbi, toHex } from "viem";
import { and, eq, isNull, isNotNull } from "drizzle-orm";
import { db, postsTable, postLikesTable, usersTable } from "@workspace/db";
import { gameRpc, checkGameDeployment, InvalidReceiptError } from "./gameChain";
import { CHAIN_ID, REGISTRY } from "./chainConfig";
import { tracedRegistrationInputs } from "./registrationChain";
import { canonicalObjectPath } from "./contentPrivacy";
import { logger } from "./logger";

export const socialAbi = parseAbi([
  "function createPost(uint256 postId, string contentUri)",
  "function likePost(uint256 postId)",
  "function postAuthor(uint256) view returns(address)",
  "function postLikes(uint256,address) view returns(bool)",
  "event PostCreated(address indexed author, uint256 indexed postId, string contentUri, uint256 timestamp)",
  "event PostLiked(address indexed liker, uint256 indexed postId, uint256 timestamp)",
]);

export function postCommitment(id: number, wallet: string, content: string, imageUrl: string, isPaid: boolean) {
  return `mf:${id}:${keccak256(toHex(JSON.stringify({ wallet: wallet.toLowerCase(), content, imageUrl, isPaid })))}`;
}

let deploymentUntil = 0;
let deploymentCheck: Promise<void> | null = null;
async function checkedDeployment() {
  if (Date.now() < deploymentUntil) return;
  if (!deploymentCheck) deploymentCheck = checkGameDeployment().then(() => { deploymentUntil = Date.now() + 15_000; })
    .finally(() => { deploymentCheck = null; });
  return deploymentCheck;
}

export async function verifySocialReceipt(kind: "post" | "like", hash: string, wallet: string, id: number, uri?: string,
  client: typeof gameRpc = gameRpc, verifyDeployment: () => Promise<void> = checkedDeployment) {
  const requireProof = (ok: unknown, reason: string) => { if (!ok) throw new InvalidReceiptError(reason); };
  requireProof(/^0x[0-9a-fA-F]{64}$/.test(hash), "A confirmed Monad transaction hash is required.");
  wallet = wallet.toLowerCase();
  await verifyDeployment();
  const receipt = await client.getTransactionReceipt({ hash: hash as `0x${string}` });
  const [tx, block] = await Promise.all([
    client.getTransaction({ hash: hash as `0x${string}` }),
    client.getBlock({ blockNumber: receipt.blockNumber }),
  ]);
  requireProof(receipt.status === "success" && tx.chainId === CHAIN_ID &&
    receipt.transactionHash.toLowerCase() === hash.toLowerCase() &&
    tx.hash.toLowerCase() === hash.toLowerCase() && tx.blockHash === receipt.blockHash &&
    tx.blockNumber === receipt.blockNumber && receipt.from.toLowerCase() === tx.from.toLowerCase() &&
    receipt.to?.toLowerCase() === tx.to?.toLowerCase() &&
    block.hash === receipt.blockHash, "Transaction is not a successful canonical Monad receipt.");
  let inputs: `0x${string}`[] = [];
  if (tx.from.toLowerCase() === wallet && tx.to?.toLowerCase() === REGISTRY.toLowerCase() &&
    receipt.from.toLowerCase() === wallet && receipt.to?.toLowerCase() === REGISTRY.toLowerCase() && tx.value === 0n) {
    inputs = [tx.input];
  } else {
    const trace = await client.request({
      method: "debug_traceTransaction" as never,
      params: [hash, { tracer: "callTracer" }] as never,
    });
    inputs = tracedRegistrationInputs(trace as Parameters<typeof tracedRegistrationInputs>[0], tx, wallet);
  }
  const calls = inputs.filter(input => {
    try {
      const call = decodeFunctionData({ abi: socialAbi, data: input });
      return kind === "post" ? call.functionName === "createPost" && call.args[0] === BigInt(id) && call.args[1] === uri
        : call.functionName === "likePost" && call.args[0] === BigInt(id);
    } catch { return false; }
  });
  requireProof(calls.length === 1, "Transaction calldata does not authorize this post or like.");
  const events = receipt.logs.filter(l => !l.removed && l.address.toLowerCase() === REGISTRY.toLowerCase()).flatMap(l => {
    try { return [decodeEventLog({ abi: socialAbi, data: l.data, topics: l.topics, strict: true })]; }
    catch { return []; }
  }).filter(e => e.eventName === (kind === "post" ? "PostCreated" : "PostLiked"));
  requireProof(events.length === 1, "Missing or ambiguous registry event.");
  const event = events[0];
  requireProof(event.args.postId === BigInt(id) && event.args.timestamp === block.timestamp,
    "Event does not match the post and block.");
  if (event.eventName === "PostCreated") {
    requireProof(event.args.author.toLowerCase() === wallet && event.args.contentUri === uri, "Post proof does not match the draft.");
    const author = await client.readContract({ address: REGISTRY, abi: socialAbi, functionName: "postAuthor", args: [BigInt(id)] });
    requireProof(author.toLowerCase() === wallet, "Registry post author does not match.");
  } else {
    requireProof(event.args.liker.toLowerCase() === wallet, "Like belongs to another wallet.");
    requireProof(await chainHasLike(id, wallet, client, verifyDeployment), "Like is not recorded in the registry.");
  }
}

export async function chainHasLike(id: number, wallet: string, client: typeof gameRpc = gameRpc, verifyDeployment: () => Promise<void> = checkedDeployment) {
  await verifyDeployment();
  return client.readContract({ address: REGISTRY, abi: socialAbi, functionName: "postLikes",
    args: [BigInt(id), wallet as `0x${string}`] });
}

// Reconcile old receipt fields once per process; never manufacture proof for
// unsigned history. Unconfirmed records remain available to their author.
let reconciliation: Promise<void> | null = null;
let nextReconciliation = 0;
export async function reconcilePostProofs() {
  if (reconciliation) return;
  if (Date.now() < nextReconciliation) return;
  reconciliation = (async () => {
    const rows = await db.select().from(postsTable).where(and(isNull(postsTable.chainVerifiedAt),
      isNotNull(postsTable.onChainTxHash))).limit(100);
    async function reconcile(post: typeof postsTable.$inferSelect) {
      const [author] = await db.select().from(usersTable).where(eq(usersTable.id, post.authorId));
      if (!author || !post.imageUrl) return;
      const path = canonicalObjectPath(post.imageUrl);
      if (!path) return;
      try {
        await verifySocialReceipt("post", post.onChainTxHash!, author.walletAddress, post.id, `mf:${post.id}:${path}`);
        await db.update(postsTable).set({ chainVerifiedAt: new Date() }).where(eq(postsTable.id, post.id));
      } catch (error) {
        logger.warn({ postId: post.id, reason: error instanceof Error ? error.name : "unknown" }, "Historical post proof not confirmed");
      }
    }
    for (let i = 0; i < rows.length; i += 5) await Promise.all(rows.slice(i, i + 5).map(reconcile));
    const likes = await db.select({ id: postLikesTable.id, postId: postLikesTable.postId, wallet: usersTable.walletAddress })
      .from(postLikesTable).innerJoin(usersTable, eq(usersTable.id, postLikesTable.userId))
      .innerJoin(postsTable, eq(postsTable.id, postLikesTable.postId))
      .where(and(isNull(postLikesTable.chainVerifiedAt), isNotNull(postsTable.chainVerifiedAt))).limit(100);
    for (let i = 0; i < likes.length; i += 5) await Promise.all(likes.slice(i, i + 5).map(async like => {
      try {
        if (await chainHasLike(like.postId, like.wallet)) await db.update(postLikesTable)
          .set({ chainVerifiedAt: new Date() }).where(eq(postLikesTable.id, like.id));
      } catch { /* Leave unknown historical likes unverified; never invent proof. */ }
    }));
  })().catch(error => {
    logger.warn({ reason: error instanceof Error ? error.name : "unknown" }, "Historical reconciliation unavailable");
  }).finally(() => { nextReconciliation = Date.now() + 300_000; reconciliation = null; });
  // Old proofs are maintenance work, not a prerequisite for serving verified posts.
}
