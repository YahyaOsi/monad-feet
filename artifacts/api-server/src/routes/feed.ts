import { Router, type IRouter } from "express";
import { eq, desc, sql } from "drizzle-orm";
import { db, postsTable, postLikesTable, usersTable, streaksTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/wallet/balance", async (req, res): Promise<void> => {
  const addr = req.headers["x-wallet-address"];
  const walletAddress = Array.isArray(addr) ? addr[0] : addr;

  if (!walletAddress) {
    res.status(400).json({ error: "Missing x-wallet-address header" });
    return;
  }

  res.json({
    walletAddress,
    monBalance: "0.00",
    mfeetBalance: "0.00",
  });
});

router.get("/feed/summary", async (req, res): Promise<void> => {
  const [postCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(postsTable);

  const [likeCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(postLikesTable);

  const [userCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(usersTable);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [activeToday] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(streaksTable)
    .where(sql`last_checkin >= ${today.toISOString()}`);

  const trending = await db
    .select({
      id: postsTable.id,
      content: postsTable.content,
      imageUrl: postsTable.imageUrl,
      authorId: postsTable.authorId,
      createdAt: postsTable.createdAt,
      authorName: usersTable.name,
      authorUsername: usersTable.username,
      authorAvatarUrl: usersTable.avatarUrl,
      likeCount: sql<number>`(select count(*) from post_likes where post_id = ${postsTable.id})::int`,
    })
    .from(postsTable)
    .leftJoin(usersTable, eq(usersTable.id, postsTable.authorId))
    .orderBy(desc(sql`(select count(*) from post_likes where post_id = ${postsTable.id})`))
    .limit(5);

  res.json({
    totalPosts: postCount?.count ?? 0,
    totalLikes: likeCount?.count ?? 0,
    totalUsers: userCount?.count ?? 0,
    activeToday: activeToday?.count ?? 0,
    trendingPosts: trending.map((p) => ({ ...p, likedByMe: false })),
  });
});

router.get("/leaderboard", async (req, res): Promise<void> => {
  const entries = await db
    .select({
      userId: streaksTable.userId,
      totalPoints: streaksTable.totalPoints,
      currentStreak: streaksTable.currentStreak,
      name: usersTable.name,
      username: usersTable.username,
      avatarUrl: usersTable.avatarUrl,
    })
    .from(streaksTable)
    .leftJoin(usersTable, eq(usersTable.id, streaksTable.userId))
    .orderBy(desc(streaksTable.totalPoints))
    .limit(50);

  res.json(
    entries.map((e, i) => ({
      rank: i + 1,
      userId: e.userId,
      name: e.name,
      username: e.username,
      avatarUrl: e.avatarUrl,
      totalPoints: e.totalPoints,
      currentStreak: e.currentStreak,
    }))
  );
});

export default router;
