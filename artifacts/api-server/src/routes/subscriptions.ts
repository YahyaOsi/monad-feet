import { Router, type IRouter } from "express";
import { randomUUID } from "node:crypto";
import { bindNewImage, canReadCreator } from "../lib/contentPrivacy";
import { eq, and } from "drizzle-orm";
import { createPublicClient, decodeEventLog, decodeFunctionData, encodeFunctionData, http, parseAbi, parseEther } from "viem";
import type { Transaction, TransactionReceipt } from "viem";
import { checkMilestones } from "../milestones";
import {
  db,
  subscriptionsTable,
  subscriptionQuotesTable,
  usersTable,
  privatePostsTable,
  badgesTable,
  notificationsTable,
  notificationPreferencesTable,
} from "@workspace/db";
import {
  CreateSubscriptionBody,
  UpdateSubscriptionPriceBody,
  GetCreatorSubscriptionPriceParams,
  ListPrivatePostsQueryParams,
  CreatePrivatePostBody,
} from "@workspace/api-zod";
import { notifyUser } from "../presence";
import { checkGameDeployment } from "../lib/gameChain";
import { claimSubscriptionQuote } from "../lib/subscriptionClaims";

const router: IRouter = Router();
import { REGISTRY, TREASURY } from "../lib/chainConfig";
const paymentAbi = parseAbi([
  "function feeRecipient() view returns (address)",
  "function subscribe(address creator) payable",
  "event Subscribed(address indexed subscriber, address indexed creator, uint256 priceWei, uint256 expiresAt)",
]);
const rpc = createPublicClient({ transport: http("https://rpc.monad.xyz") });
// The requested payment deployment is enabled. Every payment still fails
// closed unless Monad reports chain 143, the expected treasury, the expected
// contract call and a matching confirmed Subscribed event.
const PAYMENTS_ENABLED = true;

export async function verifyPayment(hash: string, subscriber: string, creator: string, price: string, quote: typeof subscriptionQuotesTable.$inferSelect) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) return null;
  await checkGameDeployment();
  if (await rpc.getChainId() !== 143) throw new Error("Wrong Monad RPC chain");
  if ((await rpc.readContract({ address: REGISTRY, abi: paymentAbi, functionName: "feeRecipient" })).toLowerCase() !== TREASURY) {
    throw new Error("Platform treasury does not match the deployed registry");
  }
  const txHash = hash as `0x${string}`;
  const receipt = await rpc.getTransactionReceipt({ hash: txHash }).catch((e: unknown) => {
    if (e instanceof Error && e.name === "TransactionReceiptNotFoundError") return null;
    throw e;
  });
  if (!receipt || receipt.status !== "success" || receipt.to?.toLowerCase() !== REGISTRY.toLowerCase() ||
      receipt.from.toLowerCase() !== subscriber) return null;
  const tx = await rpc.getTransaction({ hash: txHash });
  const block = await rpc.getBlock({ blockHash: receipt.blockHash });
  return validateSubscriptionReceipt(tx, receipt, block.timestamp, hash, subscriber, creator, price, quote);
}

export function validateSubscriptionReceipt(
  tx: Transaction, receipt: TransactionReceipt, timestamp: bigint,
  hash: string, subscriber: string, creator: string, price: string,
  quote: Pick<typeof subscriptionQuotesTable.$inferSelect, "createdAt" | "expiresAt">,
) {
  if (receipt.status !== "success" || receipt.to?.toLowerCase() !== REGISTRY.toLowerCase() ||
      receipt.from.toLowerCase() !== subscriber) return null;
  if (tx.hash.toLowerCase() !== hash.toLowerCase() || receipt.transactionHash.toLowerCase() !== hash.toLowerCase() ||
      tx.blockHash !== receipt.blockHash) return null;
  if (tx.chainId !== 143 || tx.to?.toLowerCase() !== REGISTRY.toLowerCase() ||
      tx.from.toLowerCase() !== subscriber || tx.value !== parseEther(price)) return null;
  try {
    const call = decodeFunctionData({ abi: paymentAbi, data: tx.input });
    if (call.functionName !== "subscribe" || call.args[0].toLowerCase() !== creator) return null;
    if (tx.input.toLowerCase() !== encodeFunctionData({ abi: paymentAbi, functionName: "subscribe",
      args: [creator as `0x${string}`] }).toLowerCase()) return null;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== REGISTRY.toLowerCase()) continue;
      try {
        const event = decodeEventLog({ abi: paymentAbi, data: log.data, topics: log.topics });
        if (event.eventName !== "Subscribed" || event.args.subscriber.toLowerCase() !== subscriber ||
            event.args.creator.toLowerCase() !== creator || event.args.priceWei !== tx.value) continue;
        if (timestamp < BigInt(Math.ceil(quote.createdAt.getTime() / 1000)) ||
            timestamp > BigInt(Math.floor(quote.expiresAt.getTime() / 1000))) return null;
        if (event.args.expiresAt !== timestamp + 30n * 86400n ||
            event.args.expiresAt <= BigInt(Math.floor(Date.now() / 1000))) return null;
        return new Date(Number(event.args.expiresAt) * 1000);
      } catch { continue; }
    }
  } catch { return null; }
  return null;
}

function getWalletAddress(req: { headers: Record<string, string | string[] | undefined> }): string | null {
  const addr = req.headers["x-wallet-address"];
  if (!addr) return null;
  return Array.isArray(addr) ? addr[0] : addr;
}

async function getUserByWallet(wallet: string) {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.walletAddress, wallet.toLowerCase()));
  return user ?? null;
}

async function shouldNotify(userId: number, type: string): Promise<boolean> {
  const [prefs] = await db.select().from(notificationPreferencesTable).where(eq(notificationPreferencesTable.userId, userId));
  if (!prefs) return true;
  if (type === "subscription") return prefs.subscriptionsEnabled;
  if (type === "badge") return prefs.badgesEnabled;
  return true;
}

router.get("/subscriptions", async (req, res): Promise<void> => {
  const walletAddress = getWalletAddress(req);
  if (!walletAddress) { res.status(400).json({ error: "Missing x-wallet-address header" }); return; }
  const user = await getUserByWallet(walletAddress);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  const subs = await db
    .select({
      id: subscriptionsTable.id,
      subscriberId: subscriptionsTable.subscriberId,
      creatorId: subscriptionsTable.creatorId,
      pricePerMonth: subscriptionsTable.pricePerMonth,
      consecutiveMonths: subscriptionsTable.consecutiveMonths,
      expiresAt: subscriptionsTable.expiresAt,
      createdAt: subscriptionsTable.createdAt,
      txHash: subscriptionsTable.txHash,
      creatorName: usersTable.name,
      creatorUsername: usersTable.username,
      creatorAvatarUrl: usersTable.avatarUrl,
      creatorWalletAddress: usersTable.walletAddress,
    })
    .from(subscriptionsTable)
    .leftJoin(usersTable, eq(usersTable.id, subscriptionsTable.creatorId))
    .where(eq(subscriptionsTable.subscriberId, user.id));

  res.json(subs.map((s) => ({ ...s, pricePerMonth: Number(s.pricePerMonth) })));
});

router.post("/subscriptions/quote", async (req, res): Promise<void> => {
  const wallet = getWalletAddress(req);
  const subscriber = wallet ? await getUserByWallet(wallet) : null;
  if (!subscriber) { res.status(401).json({ error: "Authenticated subscriber required" }); return; }
  const creatorId = req.body?.creatorId;
  if (!Number.isSafeInteger(creatorId) || creatorId === subscriber.id) {
    res.status(400).json({ error: "Invalid creator" }); return;
  }
  const [creator] = await db.select().from(usersTable).where(eq(usersTable.id, creatorId));
  if (!creator || !creator.subscriptionPrice || Number(creator.subscriptionPrice) <= 0) {
    res.status(422).json({ error: "Creator has no paid subscription price" }); return;
  }
  try { await checkGameDeployment(); }
  catch { res.status(503).json({ error: "Payment deployment verification unavailable" }); return; }
  const createdAt = new Date(Math.ceil(Date.now() / 1000) * 1000);
  const [quote] = await db.insert(subscriptionQuotesTable).values({
    id: randomUUID(), subscriberId: subscriber.id, creatorId,
    subscriberWallet: subscriber.walletAddress.toLowerCase(), creatorWallet: creator.walletAddress.toLowerCase(),
    price: creator.subscriptionPrice, chainId: 143, contract: REGISTRY.toLowerCase(),
    createdAt, expiresAt: new Date(createdAt.getTime() + 15 * 60_000),
  }).returning();
  res.status(201).json(quote);
});

router.post("/subscriptions", async (req, res): Promise<void> => {
  const parsed = CreateSubscriptionBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const { subscriberWalletAddress, creatorId, txHash } = parsed.data;
  const subscriber = await getUserByWallet(subscriberWalletAddress);
  if (!subscriber) { res.status(404).json({ error: "Subscriber not found" }); return; }

  const [creator] = await db.select().from(usersTable).where(eq(usersTable.id, creatorId));
  if (!creator) { res.status(404).json({ error: "Creator not found" }); return; }

  const quoteId = req.body?.quoteId;
  if (typeof quoteId !== "string") { res.status(400).json({ error: "Server-issued quote required" }); return; }
  const [quote] = await db.select().from(subscriptionQuotesTable).where(eq(subscriptionQuotesTable.id, quoteId));
  if (!quote || quote.subscriberId !== subscriber.id || quote.creatorId !== creatorId ||
      quote.subscriberWallet !== subscriber.walletAddress.toLowerCase() ||
      quote.creatorWallet !== creator.walletAddress.toLowerCase() ||
      quote.chainId !== 143 || quote.contract !== REGISTRY.toLowerCase()) {
    res.status(422).json({ error: "Quote does not match subscriber, creator or deployment" }); return;
  }
  const price = quote.price;
  const recover = async () => {
    const [claimed] = await db.select().from(subscriptionQuotesTable).where(eq(subscriptionQuotesTable.id, quote.id));
    if (claimed?.consumedHash !== txHash.toLowerCase()) return null;
    const [saved] = await db.select().from(subscriptionsTable).where(and(
      eq(subscriptionsTable.subscriberId, subscriber.id), eq(subscriptionsTable.creatorId, creatorId)));
    return saved;
  };
  if (quote.consumedHash) {
    const saved = await recover();
    if (saved) { res.json({ ...saved, pricePerMonth: Number(saved.pricePerMonth) }); return; }
    res.status(409).json({ error: "Quote already consumed by another payment" }); return;
  }
  if (!PAYMENTS_ENABLED) {
    res.status(503).json({ error: "Subscriptions are closed until the deployed payment source, 88/12 split and treasury are independently verified. No MON has been charged by this request." });
    return;
  }
  if (Number(price) <= 0) {
    res.status(422).json({ error: "The deployed contract does not support free subscriptions." }); return;
  }
  let expiresAt: Date | null;
  try {
    expiresAt = await verifyPayment(txHash, quote.subscriberWallet, quote.creatorWallet, price, quote);
  } catch {
    res.status(503).json({ error: "Monad payment verification unavailable or treasury changed; retry later" }); return;
  }
  if (!expiresAt) { res.status(422).json({ error: "Transaction is not a confirmed matching subscription payment" }); return; }

  let isNewSub = false;
  let sub: typeof subscriptionsTable.$inferSelect;
  try {
    sub = await db.transaction(async (tx) => {
      await claimSubscriptionQuote(tx, quote, txHash);
      const [existingSub] = await tx.select().from(subscriptionsTable)
        .where(and(eq(subscriptionsTable.subscriberId, subscriber.id), eq(subscriptionsTable.creatorId, creatorId)))
        .for("update");
      let saved: typeof subscriptionsTable.$inferSelect;
  if (existingSub) {
    const newConsecutiveMonths = existingSub.consecutiveMonths + 1;
    [saved] = await tx
      .update(subscriptionsTable)
      .set({ consecutiveMonths: newConsecutiveMonths, pricePerMonth: price,
        expiresAt: existingSub.expiresAt > expiresAt! ? existingSub.expiresAt : expiresAt, txHash })
      .where(eq(subscriptionsTable.id, existingSub.id))
      .returning();

    if (newConsecutiveMonths >= 2) {
      const [existingBadge] = await tx
        .select()
        .from(badgesTable)
        .where(and(eq(badgesTable.userId, subscriber.id), eq(badgesTable.creatorId, creatorId), eq(badgesTable.badgeType, "loyalty_2_months")));

      if (!existingBadge) {
        await tx.insert(badgesTable).values({
          userId: subscriber.id,
          badgeType: "loyalty_2_months",
          label: "Loyal Supporter",
          description: `Subscribed to ${creator.name ?? creator.username ?? "this creator"} for 2+ consecutive months`,
          creatorId,
        });
        // Notify subscriber they earned a badge
        if (await shouldNotify(subscriber.id, "badge")) {
          await tx.insert(notificationsTable).values({
            userId: subscriber.id,
            type: "badge",
            title: "Badge earned: Loyal Supporter",
            body: `You've subscribed to ${creator.name ?? creator.username ?? "a creator"} for 2+ consecutive months!`,
            actorId: creator.id,
            resourceType: "badge",
            read: false,
          });
        }
      }
    }
  } else {
    [saved] = await tx
      .insert(subscriptionsTable)
      .values({ subscriberId: subscriber.id, creatorId, pricePerMonth: price, consecutiveMonths: 1, txHash, expiresAt })
      .returning();
    isNewSub = true;
  }
      return saved;
    });
  } catch (e) {
    const code = (e as { code?: string; cause?: { code?: string } })?.code ??
      (e as { cause?: { code?: string } })?.cause?.code;
    if (code === "23505") {
      const saved = await recover();
      if (saved) { res.json({ ...saved, pricePerMonth: Number(saved.pricePerMonth) }); return; }
      res.status(409).json({ error: "This payment transaction was already claimed" }); return;
    }
    throw e;
  }

  // Notify creator of new subscription
  if (await shouldNotify(creator.id, "subscription")) {
    await db.insert(notificationsTable).values({
      userId: creator.id,
      type: "subscription",
      title: isNewSub ? "New subscriber!" : "Subscription renewed!",
      body: `${subscriber.name ?? subscriber.username ?? "Someone"} ${isNewSub ? "subscribed to" : "renewed their subscription to"} your content.`,
      actorId: subscriber.id,
      resourceType: "subscription",
      read: false,
    });
  }

  // Real-time WS notification to the creator
  notifyUser(creator.id, {
    type: "new_subscription",
    subscriberId: subscriber.id,
    subscriberName: subscriber.name,
    subscriberUsername: subscriber.username,
    subscriberAvatarUrl: subscriber.avatarUrl,
    isRenewal: !isNewSub,
  });

  res.status(201).json({
    id: sub.id,
    subscriberId: sub.subscriberId,
    creatorId: sub.creatorId,
    creatorName: creator.name,
    creatorUsername: creator.username,
    creatorAvatarUrl: creator.avatarUrl,
    pricePerMonth: Number(sub.pricePerMonth),
    consecutiveMonths: sub.consecutiveMonths,
    expiresAt: sub.expiresAt,
    createdAt: sub.createdAt,
  });

  // Fire-and-forget: check if the creator crossed any subscriber-count milestones
  void checkMilestones(creatorId);
});

router.put("/subscriptions/price", async (req, res): Promise<void> => {
  const parsed = UpdateSubscriptionPriceBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { walletAddress, pricePerMonth } = parsed.data;
  const [user] = await db
    .update(usersTable)
    .set({ subscriptionPrice: String(pricePerMonth) })
    .where(eq(usersTable.walletAddress, walletAddress.toLowerCase()))
    .returning();
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  res.json({ creatorId: user.id, pricePerMonth });
});

router.get("/subscriptions/price/:creatorId", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.creatorId) ? req.params.creatorId[0] : req.params.creatorId;
  const params = GetCreatorSubscriptionPriceParams.safeParse({ creatorId: rawId });
  if (!params.success) { res.status(400).json({ error: "Invalid creator id" }); return; }
  const [creator] = await db.select().from(usersTable).where(eq(usersTable.id, params.data.creatorId));
  if (!creator || !creator.subscriptionPrice) { res.status(404).json({ error: "No subscription price set" }); return; }
  res.json({ creatorId: creator.id, pricePerMonth: Number(creator.subscriptionPrice) });
});

router.get("/private-posts", async (req, res): Promise<void> => {
  const query = ListPrivatePostsQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: query.error.message }); return; }
  const walletAddress = getWalletAddress(req);
  const currentUser = walletAddress ? await getUserByWallet(walletAddress) : null;
  if (!currentUser) { res.status(401).json({ error: "Unauthorized" }); return; }
  const { creatorId } = query.data;
  if (!await canReadCreator(currentUser.id, creatorId)) {
    res.status(403).json({ error: "No active verified subscription to this creator" }); return;
  }
  const posts = await db
    .select({
      id: privatePostsTable.id,
      content: privatePostsTable.content,
      imageUrl: privatePostsTable.imageUrl,
      creatorId: privatePostsTable.creatorId,
      createdAt: privatePostsTable.createdAt,
      creatorName: usersTable.name,
      creatorUsername: usersTable.username,
      creatorAvatarUrl: usersTable.avatarUrl,
    })
    .from(privatePostsTable)
    .leftJoin(usersTable, eq(usersTable.id, privatePostsTable.creatorId))
    .where(eq(privatePostsTable.creatorId, creatorId));
  res.json(posts);
});

router.post("/private-posts", async (req, res): Promise<void> => {
  const parsed = CreatePrivatePostBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { content, imageUrl, creatorWalletAddress } = parsed.data;

  if (!imageUrl) {
    res.status(400).json({ error: "An image is required for every post." });
    return;
  }

  const creator = await getUserByWallet(creatorWalletAddress);
  if (!creator) { res.status(404).json({ error: "Creator not found" }); return; }
  try { await bindNewImage(imageUrl, creator.id, "private"); }
  catch (err) { res.status(400).json({ error: (err as Error).message }); return; }
  const [post] = await db
    .insert(privatePostsTable)
    .values({ content: content ?? "", imageUrl, creatorId: creator.id })
    .returning();
  res.status(201).json({
    id: post.id,
    content: post.content,
    imageUrl: post.imageUrl,
    creatorId: post.creatorId,
    creatorName: creator.name,
    creatorUsername: creator.username,
    creatorAvatarUrl: creator.avatarUrl,
    createdAt: post.createdAt,
  });
});

export default router;
