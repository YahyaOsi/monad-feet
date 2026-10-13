import { Router, type IRouter } from "express";
import { eq, desc, sql, isNotNull, isNull } from "drizzle-orm";
import { parseAbi } from "viem";
import { gameRpc } from "../lib/gameChain";
import { REGISTRY } from "../lib/chainConfig";
import { reconcilePostProofs } from "../lib/socialChain";
import { db, postsTable, postLikesTable, usersTable, streaksTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/wallet/balance", async (req, res): Promise<void> => {
  const addr = req.headers["x-wallet-address"];
  const walletAddress = Array.isArray(addr) ? addr[0] : addr;
  if (!walletAddress) { res.status(400).json({ error: "Missing x-wallet-address header" }); return; }
  res.json({ walletAddress, monBalance: "0.00", mfeetBalance: "0.00" });
});

router.get("/feed/summary", async (req, res): Promise<void> => {
  await reconcilePostProofs();
  const [postCount] = await db.select({ count: sql<number>`count(*)::int` }).from(postsTable).where(isNotNull(postsTable.chainVerifiedAt));
  const [pendingCount] = await db.select({ count: sql<number>`count(*)::int` }).from(postsTable).where(isNull(postsTable.chainVerifiedAt));
  let totalOnChainPosts: number | null = null;
  try { totalOnChainPosts = Number(await gameRpc.readContract({ address: REGISTRY,
    abi: parseAbi(["function getPostCount() view returns(uint256)"]), functionName: "getPostCount" })); }
  catch (error) { req.log.warn({ error }, "Registry lifetime post count unavailable"); }
  const [likeCount] = await db.select({ count: sql<number>`count(distinct (post_id, user_id))::int` }).from(postLikesTable).where(isNotNull(postLikesTable.chainVerifiedAt));
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
      likeCount: sql<number>`(select count(distinct user_id) from post_likes where post_id = ${postsTable.id} and chain_verified_at is not null)::int`,
    })
    .from(postsTable)
    .leftJoin(usersTable, eq(usersTable.id, postsTable.authorId))
    .where(isNotNull(postsTable.chainVerifiedAt))
    .orderBy(desc(sql`(select count(*) from post_likes where post_id = ${postsTable.id})`))
    .limit(5);

  res.json({
    totalPosts: postCount?.count ?? 0,
    totalOnChainPosts,
    totalPendingHistoricalPosts: pendingCount?.count ?? 0,
    totalLikes: likeCount?.count ?? 0,
    totalUsers: userCount?.count ?? 0,
    activeToday: activeToday?.count ?? 0,
    trendingPosts: trending.map((p) => ({ ...p, likedByMe: false })),
  });
});

export default router;
