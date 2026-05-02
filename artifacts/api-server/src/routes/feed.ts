import { Router, type IRouter } from "express";
import { eq, desc, sql } from "drizzle-orm";
import { db, postsTable, postLikesTable, usersTable, streaksTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/wallet/balance", async (req, res): Promise<void> => {
  const addr = req.headers["x-wallet-address"];
  const walletAddress = Array.isArray(addr) ? addr[0] : addr;
  if (!walletAddress) { res.status(400).json({ error: "Missing x-wallet-address header" }); return; }
  res.json({ walletAddress, monBalance: "0.00", mfeetBalance: "0.00" });
});

router.get("/feed/summary", async (req, res): Promise<void> => {
  const [postCount] = await db.select({ count: sql<number>`count(*)::int` }).from(postsTable);
  const [likeCount] = await db.select({ count: sql<number>`count(*)::int` }).from(postLikesTable);
  const [userCount] = await db.select({ count: sql<number>`count(*)::int` }).from(usersTable);

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
  const sortBy = (req.query.sortBy as string) ?? "points";

  // Use raw SQL to avoid Drizzle column resolution issues in subqueries
  const rows = await db.execute(sql`
    SELECT
      u.id AS "userId",
      u.name,
      u.username,
      u.avatar_url AS "avatarUrl",
      COALESCE(s.total_points, 0) AS "totalPoints",
      COALESCE(s.current_streak, 0) AS "currentStreak",
      COALESCE(s.longest_streak, 0) AS "longestStreak",
      (SELECT COUNT(*)::int FROM posts WHERE author_id = u.id) AS "postCount",
      (SELECT COUNT(*)::int FROM post_likes pl JOIN posts p2 ON p2.id = pl.post_id WHERE p2.author_id = u.id) AS "likeCount",
      (SELECT COUNT(*)::int FROM subscriptions WHERE creator_id = u.id AND expires_at > now()) AS "subscriberCount",
      (SELECT COUNT(*)::int FROM subscriptions WHERE subscriber_id = u.id AND expires_at > now()) AS "subscriptionCount"
    FROM users u
    LEFT JOIN streaks s ON s.user_id = u.id
    ORDER BY
      ${sortBy === "subscribers"
        ? sql.raw(`(SELECT COUNT(*) FROM subscriptions WHERE creator_id = u.id AND expires_at > now())`)
        : sortBy === "engagement"
        ? sql.raw(`(SELECT COUNT(*) FROM post_likes pl JOIN posts p2 ON p2.id = pl.post_id WHERE p2.author_id = u.id) + (SELECT COUNT(*) FROM posts WHERE author_id = u.id) * 2`)
        : sql.raw(`COALESCE(s.total_points, 0)`)
      } DESC
    LIMIT 50
  `);

  const entries = rows.rows as Array<{
    userId: number;
    name: string | null;
    username: string | null;
    avatarUrl: string | null;
    totalPoints: number;
    currentStreak: number;
    longestStreak: number;
    postCount: number;
    likeCount: number;
    subscriberCount: number;
    subscriptionCount: number;
  }>;

  res.json(
    entries.map((e, i) => ({
      rank: i + 1,
      userId: e.userId,
      name: e.name,
      username: e.username,
      avatarUrl: e.avatarUrl,
      totalPoints: Number(e.totalPoints),
      currentStreak: Number(e.currentStreak),
      longestStreak: Number(e.longestStreak),
      postCount: Number(e.postCount),
      likeCount: Number(e.likeCount),
      subscriberCount: Number(e.subscriberCount),
      subscriptionCount: Number(e.subscriptionCount),
      engagementScore: Number(e.likeCount) + Number(e.postCount) * 2,
    }))
  );
});

export default router;
