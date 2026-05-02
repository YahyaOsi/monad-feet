import { Router, type IRouter } from "express";
import { eq, desc, sql, and, lt } from "drizzle-orm";
import { db, postsTable, postLikesTable, usersTable, streaksTable, inviteCodesTable } from "@workspace/db";
import {
  CreatePostBody,
  ListPostsQueryParams,
  GetPostParams,
  DeletePostParams,
  LikePostParams,
  UnlikePostParams,
} from "@workspace/api-zod";
import { nanoid } from "nanoid";

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

router.get("/posts", async (req, res): Promise<void> => {
  const query = ListPostsQueryParams.safeParse(req.query);
  const limit = query.success ? (query.data.limit ?? 20) : 20;
  const cursor = query.success ? query.data.cursor : null;

  const walletAddress = getWalletAddress(req);
  const currentUser = walletAddress ? await getUserByWallet(walletAddress) : null;

  const whereClause = cursor ? lt(postsTable.id, cursor) : undefined;

  const posts = await db
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
    .where(whereClause)
    .orderBy(desc(postsTable.id))
    .limit(limit);

  const total = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(postsTable);

  const postIds = posts.map((p) => p.id);
  let likedByMe: number[] = [];

  if (currentUser && postIds.length > 0) {
    const likes = await db
      .select({ postId: postLikesTable.postId })
      .from(postLikesTable)
      .where(eq(postLikesTable.userId, currentUser.id));
    likedByMe = likes.map((l) => l.postId);
  }

  const nextCursor = posts.length === limit ? posts[posts.length - 1]?.id ?? null : null;

  res.json({
    posts: posts.map((p) => ({
      ...p,
      likedByMe: likedByMe.includes(p.id),
    })),
    nextCursor,
    total: total[0]?.count ?? 0,
  });
});

router.post("/posts", async (req, res): Promise<void> => {
  const parsed = CreatePostBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { content, imageUrl, authorWalletAddress } = parsed.data;

  const author = await getUserByWallet(authorWalletAddress);
  if (!author) {
    res.status(404).json({ error: "Author not found" });
    return;
  }

  const [post] = await db
    .insert(postsTable)
    .values({ content, imageUrl, authorId: author.id })
    .returning();

  res.status(201).json({
    id: post.id,
    content: post.content,
    imageUrl: post.imageUrl,
    authorId: post.authorId,
    authorName: author.name,
    authorUsername: author.username,
    authorAvatarUrl: author.avatarUrl,
    likeCount: 0,
    likedByMe: false,
    createdAt: post.createdAt,
  });
});

router.get("/posts/:postId", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.postId) ? req.params.postId[0] : req.params.postId;
  const params = GetPostParams.safeParse({ postId: rawId });
  if (!params.success) {
    res.status(400).json({ error: "Invalid post id" });
    return;
  }

  const walletAddress = getWalletAddress(req);
  const currentUser = walletAddress ? await getUserByWallet(walletAddress) : null;

  const [post] = await db
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
    .where(eq(postsTable.id, params.data.postId));

  if (!post) {
    res.status(404).json({ error: "Post not found" });
    return;
  }

  let likedByMe = false;
  if (currentUser) {
    const [like] = await db
      .select()
      .from(postLikesTable)
      .where(and(eq(postLikesTable.postId, post.id), eq(postLikesTable.userId, currentUser.id)));
    likedByMe = !!like;
  }

  res.json({ ...post, likedByMe });
});

router.delete("/posts/:postId", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.postId) ? req.params.postId[0] : req.params.postId;
  const params = DeletePostParams.safeParse({ postId: rawId });
  if (!params.success) {
    res.status(400).json({ error: "Invalid post id" });
    return;
  }

  const walletAddress = getWalletAddress(req);
  const currentUser = walletAddress ? await getUserByWallet(walletAddress) : null;

  if (!currentUser) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const [post] = await db.select().from(postsTable).where(eq(postsTable.id, params.data.postId));
  if (!post) {
    res.status(404).json({ error: "Post not found" });
    return;
  }

  if (post.authorId !== currentUser.id) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  await db.delete(postLikesTable).where(eq(postLikesTable.postId, post.id));
  await db.delete(postsTable).where(eq(postsTable.id, post.id));
  res.sendStatus(204);
});

router.post("/posts/:postId/like", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.postId) ? req.params.postId[0] : req.params.postId;
  const params = LikePostParams.safeParse({ postId: rawId });
  if (!params.success) {
    res.status(400).json({ error: "Invalid post id" });
    return;
  }

  const walletAddress = getWalletAddress(req);
  const currentUser = walletAddress ? await getUserByWallet(walletAddress) : null;
  if (!currentUser) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const [existing] = await db
    .select()
    .from(postLikesTable)
    .where(and(eq(postLikesTable.postId, params.data.postId), eq(postLikesTable.userId, currentUser.id)));

  if (!existing) {
    await db.insert(postLikesTable).values({ postId: params.data.postId, userId: currentUser.id });
  }

  // Update like streak for extra invite code reward
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [streak] = await db.select().from(streaksTable).where(eq(streaksTable.userId, currentUser.id));
  if (streak) {
    const lastLike = streak.lastLikeDate ? new Date(streak.lastLikeDate) : null;
    if (lastLike) lastLike.setHours(0, 0, 0, 0);
    const isNewDay = !lastLike || lastLike.getTime() < today.getTime();
    if (isNewDay) {
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const isConsecutive = lastLike && lastLike.getTime() === yesterday.getTime();
      const newLikeDays = isConsecutive ? streak.consecutiveLikeDays + 1 : 1;
      let extraInviteEarned = streak.extraInviteEarned;

      if (newLikeDays >= 5 && !extraInviteEarned) {
        const bonusCode = nanoid(10).toUpperCase();
        await db.insert(inviteCodesTable).values({ code: bonusCode, ownerId: currentUser.id });
        extraInviteEarned = true;
      }

      await db
        .update(streaksTable)
        .set({ consecutiveLikeDays: newLikeDays, lastLikeDate: new Date(), extraInviteEarned })
        .where(eq(streaksTable.userId, currentUser.id));
    }
  }

  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(postLikesTable)
    .where(eq(postLikesTable.postId, params.data.postId));

  res.json({ likeCount: countRow?.count ?? 0, likedByMe: true });
});

router.delete("/posts/:postId/like", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.postId) ? req.params.postId[0] : req.params.postId;
  const params = UnlikePostParams.safeParse({ postId: rawId });
  if (!params.success) {
    res.status(400).json({ error: "Invalid post id" });
    return;
  }

  const walletAddress = getWalletAddress(req);
  const currentUser = walletAddress ? await getUserByWallet(walletAddress) : null;
  if (!currentUser) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  await db
    .delete(postLikesTable)
    .where(and(eq(postLikesTable.postId, params.data.postId), eq(postLikesTable.userId, currentUser.id)));

  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(postLikesTable)
    .where(eq(postLikesTable.postId, params.data.postId));

  res.json({ likeCount: countRow?.count ?? 0, likedByMe: false });
});

export default router;
