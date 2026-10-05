import { Router, type IRouter } from "express";
import { eq, desc, sql, and, lt, inArray } from "drizzle-orm";
import {
  db,
  postsTable,
  postLikesTable,
  usersTable,
  streaksTable,
  inviteCodesTable,
  notificationsTable,
  notificationPreferencesTable,
  subscriptionsTable,
} from "@workspace/db";
import {
  CreatePostBody,
  ListPostsQueryParams,
  GetPostParams,
  DeletePostParams,
  LikePostParams,
  UnlikePostParams,
} from "@workspace/api-zod";
import { nanoid } from "nanoid";
import { broadcastActivity, checkAndNotifyTrending } from "../presence";
import { checkMilestones } from "../milestones";
import { bindNewImage, verifiedCreatorIds, preservePrivateBinding } from "../lib/contentPrivacy";

const router: IRouter = Router();

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
  if (type === "like") return prefs.likesEnabled;
  if (type === "subscription") return prefs.subscriptionsEnabled;
  if (type === "badge") return prefs.badgesEnabled;
  if (type === "system") return prefs.systemEnabled;
  return true;
}

/** Returns the set of authorIds that currentUserId is actively subscribed to */
async function getSubscribedAuthorIds(currentUserId: number): Promise<Set<number>> {
  return verifiedCreatorIds(currentUserId);
}

router.get("/posts", async (req, res): Promise<void> => {
  const query = ListPostsQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: query.error.message }); return; }
  if (query.data.authorId !== undefined &&
      (!Number.isSafeInteger(query.data.authorId) || query.data.authorId < 1 || query.data.authorId > 2_147_483_647)) {
    res.status(400).json({ error: "Invalid author id" }); return;
  }
  const limit = query.data.limit ?? 20;
  const cursor = query.data.cursor ?? null;
  const authorFilter = query.data.authorId === undefined
    ? undefined
    : eq(postsTable.authorId, query.data.authorId);
  const walletAddress = getWalletAddress(req);
  const currentUser = walletAddress ? await getUserByWallet(walletAddress) : null;
  const whereClause = and(authorFilter, cursor ? lt(postsTable.id, cursor) : undefined);

  const posts = await db
    .select({
      id: postsTable.id,
      content: postsTable.content,
      imageUrl: postsTable.imageUrl,
      authorId: postsTable.authorId,
      onChainTxHash: postsTable.onChainTxHash,
      isPaid: postsTable.isPaid,
      createdAt: postsTable.createdAt,
      authorName: usersTable.name,
      authorUsername: usersTable.username,
      authorAvatarUrl: usersTable.avatarUrl,
      authorNftHolder: usersTable.nftHolder,
      likeCount: sql<number>`(select count(*) from post_likes where post_id = ${postsTable.id})::int`,
    })
    .from(postsTable)
    .leftJoin(usersTable, eq(usersTable.id, postsTable.authorId))
    .where(whereClause)
    .orderBy(desc(postsTable.id))
    .limit(limit);

  const total = await db.select({ count: sql<number>`count(*)::int` }).from(postsTable).where(authorFilter);
  const postIds = posts.map((p) => p.id);
  let likedByMe: number[] = [];
  let subscribedAuthorIds = new Set<number>();

  if (currentUser && postIds.length > 0) {
    const likes = await db
      .select({ postId: postLikesTable.postId })
      .from(postLikesTable)
      .where(eq(postLikesTable.userId, currentUser.id));
    likedByMe = likes.map((l) => l.postId);
    subscribedAuthorIds = await getSubscribedAuthorIds(currentUser.id);
  }

  const nextCursor = posts.length === limit ? posts[posts.length - 1]?.id ?? null : null;
  res.json({
    posts: posts.map((p) => ({
      ...p,
      likedByMe: likedByMe.includes(p.id),
      isSubscribedToAuthor:
        currentUser?.id === p.authorId || subscribedAuthorIds.has(p.authorId),
    })),
    nextCursor,
    total: total[0]?.count ?? 0,
  });
});

router.post("/posts", async (req, res): Promise<void> => {
  const parsed = CreatePostBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const { content, imageUrl, authorWalletAddress, isPaid } = parsed.data;

  if (!imageUrl) {
    res.status(400).json({ error: "An image is required for every post." });
    return;
  }

  const author = await getUserByWallet(authorWalletAddress);
  if (!author) { res.status(404).json({ error: "Author not found" }); return; }
  try { await bindNewImage(imageUrl, author.id, isPaid ? "private" : "public"); }
  catch (err) { res.status(400).json({ error: (err as Error).message }); return; }

  const [post] = await db
    .insert(postsTable)
    .values({ content: content ?? "", imageUrl, authorId: author.id, isPaid: isPaid ?? false })
    .returning();

  const payload = {
    id: post.id,
    content: post.content,
    imageUrl: post.imageUrl,
    authorId: post.authorId,
    authorName: author.name,
    authorUsername: author.username,
    authorAvatarUrl: author.avatarUrl,
    authorNftHolder: author.nftHolder,
    onChainTxHash: null as string | null,
    isPaid: post.isPaid,
    isSubscribedToAuthor: true,
    likeCount: 0,
    likedByMe: false,
    createdAt: post.createdAt,
  };

  res.status(201).json(payload);

  // Broadcast new post to all connected clients
  broadcastActivity({ type: "post_created", post: { ...payload, authorAvatarUrl: null,
    ...(post.isPaid ? { content: "", imageUrl: null, isSubscribedToAuthor: false } : {}) }, actorId: author.id });

  // Fire-and-forget: check if author crossed any post-count milestones
  void checkMilestones(author.id);
});

router.get("/posts/:postId", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.postId) ? req.params.postId[0] : req.params.postId;
  const params = GetPostParams.safeParse({ postId: rawId });
  if (!params.success) { res.status(400).json({ error: "Invalid post id" }); return; }

  const walletAddress = getWalletAddress(req);
  const currentUser = walletAddress ? await getUserByWallet(walletAddress) : null;

  const [post] = await db
    .select({
      id: postsTable.id,
      content: postsTable.content,
      imageUrl: postsTable.imageUrl,
      authorId: postsTable.authorId,
      createdAt: postsTable.createdAt,
      onChainTxHash: postsTable.onChainTxHash,
      isPaid: postsTable.isPaid,
      authorName: usersTable.name,
      authorUsername: usersTable.username,
      authorAvatarUrl: usersTable.avatarUrl,
      authorNftHolder: usersTable.nftHolder,
      likeCount: sql<number>`(select count(*) from post_likes where post_id = ${postsTable.id})::int`,
    })
    .from(postsTable)
    .leftJoin(usersTable, eq(usersTable.id, postsTable.authorId))
    .where(eq(postsTable.id, params.data.postId));

  if (!post) { res.status(404).json({ error: "Post not found" }); return; }

  let likedByMe = false;
  let isSubscribedToAuthor = false;
  if (currentUser) {
    const [like] = await db
      .select()
      .from(postLikesTable)
      .where(and(eq(postLikesTable.postId, post.id), eq(postLikesTable.userId, currentUser.id)));
    likedByMe = !!like;
    if (currentUser.id === post.authorId) {
      isSubscribedToAuthor = true;
    } else {
      const subs = await getSubscribedAuthorIds(currentUser.id);
      isSubscribedToAuthor = subs.has(post.authorId);
    }
  }
  res.json({ ...post, likedByMe, isSubscribedToAuthor });
});

router.delete("/posts/:postId", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.postId) ? req.params.postId[0] : req.params.postId;
  const params = DeletePostParams.safeParse({ postId: rawId });
  if (!params.success) { res.status(400).json({ error: "Invalid post id" }); return; }

  const walletAddress = getWalletAddress(req);
  const currentUser = walletAddress ? await getUserByWallet(walletAddress) : null;
  if (!currentUser) { res.status(401).json({ error: "Unauthorized" }); return; }

  const [post] = await db.select().from(postsTable).where(eq(postsTable.id, params.data.postId));
  if (!post) { res.status(404).json({ error: "Post not found" }); return; }
  if (post.authorId !== currentUser.id) { res.status(403).json({ error: "Forbidden" }); return; }

  if (post.isPaid && post.imageUrl) await preservePrivateBinding(post.imageUrl, post.authorId);
  await db.delete(postLikesTable).where(eq(postLikesTable.postId, post.id));
  await db.delete(postsTable).where(eq(postsTable.id, post.id));
  res.sendStatus(204);
});

router.post("/posts/:postId/like", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.postId) ? req.params.postId[0] : req.params.postId;
  const params = LikePostParams.safeParse({ postId: rawId });
  if (!params.success) { res.status(400).json({ error: "Invalid post id" }); return; }

  const walletAddress = getWalletAddress(req);
  const currentUser = walletAddress ? await getUserByWallet(walletAddress) : null;
  if (!currentUser) { res.status(401).json({ error: "Unauthorized" }); return; }

  const [post] = await db.select().from(postsTable).where(eq(postsTable.id, params.data.postId));
  if (!post) { res.status(404).json({ error: "Post not found" }); return; }

  const [existing] = await db
    .select()
    .from(postLikesTable)
    .where(and(eq(postLikesTable.postId, params.data.postId), eq(postLikesTable.userId, currentUser.id)));

  const likeTxHash = typeof req.body?.txHash === "string" ? req.body.txHash : null;

  if (!existing) {
    await db.insert(postLikesTable).values({
      postId: params.data.postId,
      userId: currentUser.id,
      ...(likeTxHash ? { onChainTxHash: likeTxHash } : {}),
    });

    if (post.authorId !== currentUser.id && (await shouldNotify(post.authorId, "like"))) {
      await db.insert(notificationsTable).values({
        userId: post.authorId,
        type: "like",
        title: "Someone liked your post",
        body: `${currentUser.name ?? currentUser.username ?? "A user"} liked your post.`,
        actorId: currentUser.id,
        resourceId: post.id,
        resourceType: "post",
        read: false,
      });
    }
  }

  // Like streak
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (!existing) await db.transaction(async (tx) => {
  const [streak] = await tx.select().from(streaksTable).where(eq(streaksTable.userId, currentUser.id)).for("update");
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
        await tx.insert(inviteCodesTable).values({ code: bonusCode, ownerId: currentUser.id });
        await tx.update(streaksTable).set({
          totalPoints: sql`${streaksTable.totalPoints} + 10`,
        }).where(eq(streaksTable.userId, currentUser.id));
        extraInviteEarned = true;
        if (await shouldNotify(currentUser.id, "system")) {
          await tx.insert(notificationsTable).values({
            userId: currentUser.id,
            type: "system",
            title: "Bonus invite code unlocked!",
            body: "You liked posts 5 days in a row. A new invite code has been added to your wallet.",
            read: false,
          });
        }
      }
      await tx
        .update(streaksTable)
        .set({ consecutiveLikeDays: newLikeDays, lastLikeDate: new Date(), extraInviteEarned })
        .where(eq(streaksTable.userId, currentUser.id));
    }
  }
  });

  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(postLikesTable)
    .where(eq(postLikesTable.postId, params.data.postId));

  const newLikeCount = countRow?.count ?? 0;
  res.json({ likeCount: newLikeCount, likedByMe: true });

  broadcastActivity({ type: "post_liked", postId: params.data.postId, likeCount: newLikeCount, actorId: currentUser.id });
  void checkAndNotifyTrending(params.data.postId, post.authorId, post.isPaid ? "Exclusive post" : post.content);
  void checkMilestones(post.authorId);
});

router.patch("/posts/:postId/anchor", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.postId) ? req.params.postId[0] : req.params.postId;
  const postId = parseInt(rawId, 10);
  if (isNaN(postId)) { res.status(400).json({ error: "Invalid post id" }); return; }

  const txHash = typeof req.body?.txHash === "string" ? req.body.txHash.trim() : null;
  if (!txHash || !txHash.startsWith("0x")) { res.status(400).json({ error: "txHash must be a 0x-prefixed hex string" }); return; }

  const walletAddress = getWalletAddress(req);
  const currentUser = walletAddress ? await getUserByWallet(walletAddress) : null;
  if (!currentUser) { res.status(401).json({ error: "Unauthorized" }); return; }

  const [post] = await db.select().from(postsTable).where(eq(postsTable.id, postId));
  if (!post) { res.status(404).json({ error: "Post not found" }); return; }
  if (post.authorId !== currentUser.id) { res.status(403).json({ error: "Forbidden" }); return; }

  const [updated] = await db
    .update(postsTable)
    .set({ onChainTxHash: txHash })
    .where(eq(postsTable.id, postId))
    .returning({ onChainTxHash: postsTable.onChainTxHash });

  res.json({ onChainTxHash: updated.onChainTxHash });
  broadcastActivity({ type: "post_anchored", postId, txHash });
});

router.delete("/posts/:postId/like", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.postId) ? req.params.postId[0] : req.params.postId;
  const params = UnlikePostParams.safeParse({ postId: rawId });
  if (!params.success) { res.status(400).json({ error: "Invalid post id" }); return; }

  const walletAddress = getWalletAddress(req);
  const currentUser = walletAddress ? await getUserByWallet(walletAddress) : null;
  if (!currentUser) { res.status(401).json({ error: "Unauthorized" }); return; }

  await db
    .delete(postLikesTable)
    .where(and(eq(postLikesTable.postId, params.data.postId), eq(postLikesTable.userId, currentUser.id)));

  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(postLikesTable)
    .where(eq(postLikesTable.postId, params.data.postId));

  const newLikeCount = countRow?.count ?? 0;
  res.json({ likeCount: newLikeCount, likedByMe: false });
  broadcastActivity({ type: "post_liked", postId: params.data.postId, likeCount: newLikeCount, actorId: currentUser.id });
});

export default router;
