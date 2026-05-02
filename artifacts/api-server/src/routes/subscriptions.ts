import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, subscriptionsTable, usersTable, privatePostsTable, badgesTable } from "@workspace/db";
import {
  CreateSubscriptionBody,
  UpdateSubscriptionPriceBody,
  GetCreatorSubscriptionPriceParams,
  ListPrivatePostsQueryParams,
  CreatePrivatePostBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

function getWalletAddress(req: { headers: Record<string, string | string[] | undefined> }): string | null {
  const addr = req.headers["x-wallet-address"];
  if (!addr) return null;
  return Array.isArray(addr) ? addr[0] : addr;
}

async function getUserByWallet(wallet: string) {
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.walletAddress, wallet.toLowerCase()));
  return user ?? null;
}

router.get("/subscriptions", async (req, res): Promise<void> => {
  const walletAddress = getWalletAddress(req);
  if (!walletAddress) {
    res.status(400).json({ error: "Missing x-wallet-address header" });
    return;
  }

  const user = await getUserByWallet(walletAddress);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const subs = await db
    .select({
      id: subscriptionsTable.id,
      subscriberId: subscriptionsTable.subscriberId,
      creatorId: subscriptionsTable.creatorId,
      pricePerMonth: subscriptionsTable.pricePerMonth,
      consecutiveMonths: subscriptionsTable.consecutiveMonths,
      expiresAt: subscriptionsTable.expiresAt,
      createdAt: subscriptionsTable.createdAt,
      creatorName: usersTable.name,
      creatorUsername: usersTable.username,
      creatorAvatarUrl: usersTable.avatarUrl,
    })
    .from(subscriptionsTable)
    .leftJoin(usersTable, eq(usersTable.id, subscriptionsTable.creatorId))
    .where(eq(subscriptionsTable.subscriberId, user.id));

  res.json(
    subs.map((s) => ({
      ...s,
      pricePerMonth: Number(s.pricePerMonth),
    }))
  );
});

router.post("/subscriptions", async (req, res): Promise<void> => {
  const parsed = CreateSubscriptionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { subscriberWalletAddress, creatorId, txHash } = parsed.data;

  const subscriber = await getUserByWallet(subscriberWalletAddress);
  if (!subscriber) {
    res.status(404).json({ error: "Subscriber not found" });
    return;
  }

  const [creator] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, creatorId));

  if (!creator) {
    res.status(404).json({ error: "Creator not found" });
    return;
  }

  const price = creator.subscriptionPrice ? Number(creator.subscriptionPrice) : 0;
  const expiresAt = new Date();
  expiresAt.setMonth(expiresAt.getMonth() + 1);

  const [existingSub] = await db
    .select()
    .from(subscriptionsTable)
    .where(
      and(
        eq(subscriptionsTable.subscriberId, subscriber.id),
        eq(subscriptionsTable.creatorId, creatorId)
      )
    );

  let sub;
  if (existingSub) {
    const newConsecutiveMonths = existingSub.consecutiveMonths + 1;
    [sub] = await db
      .update(subscriptionsTable)
      .set({
        consecutiveMonths: newConsecutiveMonths,
        expiresAt,
        txHash,
      })
      .where(eq(subscriptionsTable.id, existingSub.id))
      .returning();

    if (newConsecutiveMonths >= 2) {
      const [existingBadge] = await db
        .select()
        .from(badgesTable)
        .where(
          and(
            eq(badgesTable.userId, subscriber.id),
            eq(badgesTable.creatorId, creatorId),
            eq(badgesTable.badgeType, "loyalty_2_months")
          )
        );

      if (!existingBadge) {
        await db.insert(badgesTable).values({
          userId: subscriber.id,
          badgeType: "loyalty_2_months",
          label: "Loyal Supporter",
          description: `Subscribed to ${creator.name ?? creator.username ?? "this creator"} for 2+ consecutive months`,
          creatorId,
        });
      }
    }
  } else {
    [sub] = await db
      .insert(subscriptionsTable)
      .values({
        subscriberId: subscriber.id,
        creatorId,
        pricePerMonth: String(price),
        consecutiveMonths: 1,
        txHash,
        expiresAt,
      })
      .returning();
  }

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
});

router.put("/subscriptions/price", async (req, res): Promise<void> => {
  const parsed = UpdateSubscriptionPriceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { walletAddress, pricePerMonth } = parsed.data;

  const [user] = await db
    .update(usersTable)
    .set({ subscriptionPrice: String(pricePerMonth) })
    .where(eq(usersTable.walletAddress, walletAddress.toLowerCase()))
    .returning();

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json({ creatorId: user.id, pricePerMonth });
});

router.get("/subscriptions/price/:creatorId", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.creatorId) ? req.params.creatorId[0] : req.params.creatorId;
  const params = GetCreatorSubscriptionPriceParams.safeParse({ creatorId: rawId });
  if (!params.success) {
    res.status(400).json({ error: "Invalid creator id" });
    return;
  }

  const [creator] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, params.data.creatorId));

  if (!creator || !creator.subscriptionPrice) {
    res.status(404).json({ error: "No subscription price set" });
    return;
  }

  res.json({ creatorId: creator.id, pricePerMonth: Number(creator.subscriptionPrice) });
});

router.get("/private-posts", async (req, res): Promise<void> => {
  const query = ListPrivatePostsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const walletAddress = getWalletAddress(req);
  const currentUser = walletAddress ? await getUserByWallet(walletAddress) : null;

  if (!currentUser) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const { creatorId } = query.data;

  const [activeSub] = await db
    .select()
    .from(subscriptionsTable)
    .where(
      and(
        eq(subscriptionsTable.subscriberId, currentUser.id),
        eq(subscriptionsTable.creatorId, creatorId)
      )
    );

  const isCreatorSelf = currentUser.id === creatorId;

  if (!activeSub && !isCreatorSelf) {
    res.status(403).json({ error: "Not subscribed to this creator" });
    return;
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
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { content, imageUrl, creatorWalletAddress } = parsed.data;
  const creator = await getUserByWallet(creatorWalletAddress);
  if (!creator) {
    res.status(404).json({ error: "Creator not found" });
    return;
  }

  const [post] = await db
    .insert(privatePostsTable)
    .values({ content, imageUrl, creatorId: creator.id })
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
