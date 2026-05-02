import { Router, type IRouter } from "express";
import { eq, sql, ilike, or, desc } from "drizzle-orm";
import { db, usersTable, inviteCodesTable, streaksTable, postsTable, postLikesTable, subscriptionsTable, privatePostsTable } from "@workspace/db";
import {
  RegisterUserBody,
  UpdateMeBody,
  GetUserParams,
} from "@workspace/api-zod";
import { nanoid } from "nanoid";

const router: IRouter = Router();

function getWalletAddress(req: { headers: Record<string, string | string[] | undefined> }): string | null {
  const addr = req.headers["x-wallet-address"];
  if (!addr) return null;
  return Array.isArray(addr) ? addr[0] : addr;
}

function formatUser(user: typeof usersTable.$inferSelect & {
  postCount?: number;
  totalLikes?: number;
  streakPoints?: number;
  currentStreak?: number;
}) {
  return {
    id: user.id,
    walletAddress: user.walletAddress,
    email: user.email,
    name: user.name,
    username: user.username,
    avatarUrl: user.avatarUrl,
    bio: user.bio,
    registrationTxHash: user.registrationTxHash,
    subscriptionPrice: user.subscriptionPrice ? Number(user.subscriptionPrice) : null,
    createdAt: user.createdAt,
    postCount: user.postCount ?? 0,
    totalLikes: user.totalLikes ?? 0,
    streakPoints: user.streakPoints ?? 0,
    currentStreak: user.currentStreak ?? 0,
  };
}

router.post("/auth/register", async (req, res): Promise<void> => {
  const parsed = RegisterUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { walletAddress, inviteCode, email, name, username, avatarUrl } = parsed.data;
  const registrationTxHash = typeof req.body?.txHash === "string" ? req.body.txHash : null;

  const [invite] = await db
    .select()
    .from(inviteCodesTable)
    .where(eq(inviteCodesTable.code, inviteCode));

  if (!invite) {
    res.status(400).json({ error: "Invalid invite code" });
    return;
  }

  if (invite.usedById !== null) {
    res.status(400).json({ error: "Invite code already used" });
    return;
  }

  const [existingUser] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.walletAddress, walletAddress.toLowerCase()));

  if (existingUser) {
    res.status(409).json({ error: "User already exists" });
    return;
  }

  const [existingUsername] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.username, username));

  if (existingUsername) {
    res.status(400).json({ error: "Username already taken" });
    return;
  }

  const [newUser] = await db
    .insert(usersTable)
    .values({
      walletAddress: walletAddress.toLowerCase(),
      email,
      name,
      username,
      avatarUrl,
      registrationTxHash,
    })
    .returning();

  await db
    .update(inviteCodesTable)
    .set({ usedById: newUser.id, usedAt: new Date() })
    .where(eq(inviteCodesTable.id, invite.id));

  const inviteCode1 = nanoid(10).toUpperCase();
  const inviteCode2 = nanoid(10).toUpperCase();
  await db.insert(inviteCodesTable).values([
    { code: inviteCode1, ownerId: newUser.id },
    { code: inviteCode2, ownerId: newUser.id },
  ]);

  await db.insert(streaksTable).values({ userId: newUser.id });

  res.status(201).json(formatUser({ ...newUser }));
});

router.get("/users/me", async (req, res): Promise<void> => {
  const walletAddress = getWalletAddress(req);
  if (!walletAddress) {
    res.status(400).json({ error: "Missing x-wallet-address header" });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.walletAddress, walletAddress.toLowerCase()));

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json(formatUser({ ...user }));
});

router.put("/users/me", async (req, res): Promise<void> => {
  const parsed = UpdateMeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { walletAddress, name, username, avatarUrl, bio } = parsed.data;

  const [user] = await db
    .update(usersTable)
    .set({ name, username, avatarUrl, bio })
    .where(eq(usersTable.walletAddress, walletAddress.toLowerCase()))
    .returning();

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json(formatUser({ ...user }));
});

// Search must come BEFORE /:userId to avoid matching "search" as a userId
router.get("/users/search", async (req, res): Promise<void> => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (!q || q.length < 1) { res.status(400).json({ error: "Query required" }); return; }
  const limit = Math.min(parseInt(String(req.query.limit ?? "20"), 10) || 20, 50);

  const pattern = `%${q}%`;
  const users = await db
    .select()
    .from(usersTable)
    .where(or(ilike(usersTable.username, pattern), ilike(usersTable.name, pattern)))
    .limit(limit);

  const results = await Promise.all(
    users.map(async (u) => {
      const [postCount] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(postsTable)
        .where(eq(postsTable.authorId, u.id));
      const [likes] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(postLikesTable)
        .innerJoin(postsTable, eq(postsTable.id, postLikesTable.postId))
        .where(eq(postsTable.authorId, u.id));
      const [streak] = await db.select().from(streaksTable).where(eq(streaksTable.userId, u.id));
      return formatUser({
        ...u,
        postCount: postCount?.count ?? 0,
        totalLikes: likes?.count ?? 0,
        streakPoints: streak?.totalPoints ?? 0,
        currentStreak: streak?.currentStreak ?? 0,
      });
    })
  );

  res.json(results);
});

router.get("/users/:userId/analytics", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
  const userId = parseInt(rawId, 10);
  if (isNaN(userId)) { res.status(400).json({ error: "Invalid user id" }); return; }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  const pricePerMonth = user.subscriptionPrice ? Number(user.subscriptionPrice) : 0;

  const [totalSubRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.creatorId, userId));

  const [activeSubRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(subscriptionsTable)
    .where(sql`creator_id = ${userId} AND expires_at > now()`);

  const [totalPostRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(postsTable)
    .where(eq(postsTable.authorId, userId));

  const [privatePostRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(privatePostsTable)
    .where(eq(privatePostsTable.creatorId, userId));

  const [likesRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(postLikesTable)
    .innerJoin(postsTable, eq(postsTable.id, postLikesTable.postId))
    .where(eq(postsTable.authorId, userId));

  const topPosts = await db
    .select({
      id: postsTable.id,
      content: postsTable.content,
      imageUrl: postsTable.imageUrl,
      authorId: postsTable.authorId,
      onChainTxHash: postsTable.onChainTxHash,
      createdAt: postsTable.createdAt,
      authorName: usersTable.name,
      authorUsername: usersTable.username,
      authorAvatarUrl: usersTable.avatarUrl,
      likeCount: sql<number>`(select count(*) from post_likes where post_id = ${postsTable.id})::int`,
    })
    .from(postsTable)
    .leftJoin(usersTable, eq(usersTable.id, postsTable.authorId))
    .where(eq(postsTable.authorId, userId))
    .orderBy(desc(sql`(select count(*) from post_likes where post_id = ${postsTable.id})`))
    .limit(5);

  const recentSubs = await db
    .select({
      subscriberId: subscriptionsTable.subscriberId,
      consecutiveMonths: subscriptionsTable.consecutiveMonths,
      subscribedAt: subscriptionsTable.createdAt,
      subscriberName: usersTable.name,
      subscriberUsername: usersTable.username,
      subscriberAvatarUrl: usersTable.avatarUrl,
    })
    .from(subscriptionsTable)
    .leftJoin(usersTable, eq(usersTable.id, subscriptionsTable.subscriberId))
    .where(eq(subscriptionsTable.creatorId, userId))
    .orderBy(desc(subscriptionsTable.createdAt))
    .limit(5);

  const totalSubs = totalSubRow?.count ?? 0;
  const activeSubs = activeSubRow?.count ?? 0;

  res.json({
    userId,
    totalSubscribers: totalSubs,
    activeSubscribers: activeSubs,
    totalRevenueMon: totalSubs * pricePerMonth,
    monthlyRevenueMon: activeSubs * pricePerMonth,
    totalPosts: totalPostRow?.count ?? 0,
    privatePosts: privatePostRow?.count ?? 0,
    totalLikes: likesRow?.count ?? 0,
    topPosts: topPosts.map((p) => ({ ...p, likedByMe: false })),
    recentSubscribers: recentSubs.map((s) => ({
      subscriberId: s.subscriberId,
      subscriberName: s.subscriberName,
      subscriberUsername: s.subscriberUsername,
      subscriberAvatarUrl: s.subscriberAvatarUrl,
      consecutiveMonths: s.consecutiveMonths,
      subscribedAt: s.subscribedAt,
    })),
  });
});

router.get("/users/:userId", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
  const params = GetUserParams.safeParse({ userId: rawId });
  if (!params.success) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, params.data.userId));

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const [postCountResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(postsTable)
    .where(eq(postsTable.authorId, user.id));

  const [likesResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(postLikesTable)
    .innerJoin(postsTable, eq(postsTable.id, postLikesTable.postId))
    .where(eq(postsTable.authorId, user.id));

  const [streak] = await db
    .select()
    .from(streaksTable)
    .where(eq(streaksTable.userId, user.id));

  res.json(formatUser({
    ...user,
    postCount: postCountResult?.count ?? 0,
    totalLikes: likesResult?.count ?? 0,
    streakPoints: streak?.totalPoints ?? 0,
    currentStreak: streak?.currentStreak ?? 0,
  }));
});

export default router;
