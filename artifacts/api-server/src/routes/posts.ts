import { Router, type IRouter } from "express";
import { eq, desc, sql, and, lt, inArray, isNotNull, or } from "drizzle-orm";
import {
  db,
  postsTable,
  postDraftsTable,
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
  RecoverPostBody,
  ListPostsQueryParams,
  GetPostParams,
  DeletePostParams,
  LikePostParams,
  UnlikePostParams,
} from "@workspace/api-zod";
import { nanoid } from "nanoid";
import { broadcastActivity, checkAndNotifyTrending } from "../presence";
import { checkMilestones } from "../milestones";
import { assertImageBinding, bindNewImage, verifiedCreatorIds, canonicalObjectPath } from "../lib/contentPrivacy";
import { verifySocialReceipt, chainHasLike, postCommitment, reconcilePostProofs } from "../lib/socialChain";
import { recoverPostReceipt } from "../lib/postRecovery";
import { InvalidReceiptError } from "../lib/gameChain";

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
  await reconcilePostProofs();
  const query = ListPostsQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: query.error.message }); return; }
  if (query.data.authorId !== undefined &&
      (!Number.isSafeInteger(query.data.authorId) || query.data.authorId < 1 || query.data.authorId > 2_147_483_647)) {
    res.status(400).json({ error: "Invalid author id" }); return;
  }
  const requestedLimit = query.data.limit ?? 20;
  if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1) {
    res.status(400).json({ error: "Page size must be a positive integer." }); return;
  }
  const limit = Math.min(requestedLimit, 100);
  const cursor = query.data.cursor ?? null;
  const authorFilter = query.data.authorId === undefined
    ? undefined
    : eq(postsTable.authorId, query.data.authorId);
  const walletAddress = getWalletAddress(req);
  const currentUser = walletAddress ? await getUserByWallet(walletAddress) : null;
  const publicationFilter = currentUser && currentUser.id === query.data.authorId ? undefined : isNotNull(postsTable.chainVerifiedAt);
  const cursorPost = cursor ? (await db.select({ createdAt: postsTable.createdAt }).from(postsTable).where(eq(postsTable.id, cursor)))[0] : null;
  if (cursor && !cursorPost) { res.status(400).json({ error: "Unknown post cursor" }); return; }
  const whereClause = and(authorFilter, publicationFilter, cursorPost ? or(
    lt(postsTable.createdAt, cursorPost.createdAt),
    and(eq(postsTable.createdAt, cursorPost.createdAt), lt(postsTable.id, cursor!)),
  ) : undefined);

  const posts = await db
    .select({
      id: postsTable.id,
      content: postsTable.content,
      imageUrl: postsTable.imageUrl,
      authorId: postsTable.authorId,
      onChainTxHash: postsTable.onChainTxHash,
      chainVerifiedAt: postsTable.chainVerifiedAt,
      isPaid: postsTable.isPaid,
      createdAt: postsTable.createdAt,
      authorName: usersTable.name,
      authorUsername: usersTable.username,
      authorAvatarUrl: usersTable.avatarUrl,
      authorNftHolder: usersTable.nftHolder,
      likeCount: sql<number>`(select count(distinct user_id) from post_likes where post_id = ${postsTable.id} and chain_verified_at is not null)::int`,
    })
    .from(postsTable)
    .leftJoin(usersTable, eq(usersTable.id, postsTable.authorId))
    .where(whereClause)
    .orderBy(desc(postsTable.createdAt), desc(postsTable.id))
    .limit(limit);

  const total = await db.select({ count: sql<number>`count(*)::int` }).from(postsTable).where(and(authorFilter, publicationFilter));
  const postIds = posts.map((p) => p.id);
  let likedByMe: number[] = [];
  let subscribedAuthorIds = new Set<number>();

  if (currentUser && postIds.length > 0) {
    const likes = await db
      .select({ postId: postLikesTable.postId })
      .from(postLikesTable)
      .where(and(eq(postLikesTable.userId, currentUser.id), isNotNull(postLikesTable.chainVerifiedAt)));
    likedByMe = likes.map((l) => l.postId);
    subscribedAuthorIds = await getSubscribedAuthorIds(currentUser.id);
  }

  const nextCursor = posts.length === limit ? posts[posts.length - 1]?.id ?? null : null;
  res.json({
    posts: posts.map((p) => ({
      ...p,
      publicationConfirmed: !!p.chainVerifiedAt,
      onChainTxHash: p.chainVerifiedAt ? p.onChainTxHash : null,
      likedByMe: likedByMe.includes(p.id),
      isSubscribedToAuthor:
        currentUser?.id === p.authorId || subscribedAuthorIds.has(p.authorId),
    })),
    nextCursor,
    total: total[0]?.count ?? 0,
  });
});

router.post("/posts/recover", async (req, res): Promise<void> => {
  const wallet = getWalletAddress(req);
  const author = wallet ? await getUserByWallet(wallet) : null;
  if (!author) { res.status(401).json({ error: "Signed member session required." }); return; }
  const parsed = RecoverPostBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "A valid post ID is required." }); return; }
  const [draft] = await db.select().from(postDraftsTable).where(eq(postDraftsTable.id, parsed.data.postId));
  if (!draft || draft.authorId !== author.id) { res.status(403).json({ error: "Prepare an owned draft first." }); return; }
  try {
    const [historical] = await db.select().from(postsTable).where(and(eq(postsTable.id, draft.id), eq(postsTable.authorId, author.id)));
    const path = historical?.imageUrl ? canonicalObjectPath(historical.imageUrl) : null;
    res.json(await recoverPostReceipt(draft.id, author.walletAddress, draft.contentUri, undefined, undefined,
      draft.createdAt, path ? `mf:${draft.id}:${path}` : undefined, historical?.createdAt));
  } catch (error) {
    req.log.warn({ postId: draft.id, reason: error instanceof Error ? error.name : "unknown" }, "Post recovery unavailable");
    res.status(error instanceof InvalidReceiptError ? 409 : 503).json({
      error: error instanceof InvalidReceiptError ? error.message :
        "Couldn't retrieve the original Monad receipt right now. Your draft is safe. Retry, or paste the confirmed transaction hash from your wallet. No new transaction was requested.",
    });
  }
});

router.post("/posts/prepare", async (req, res): Promise<void> => {
  const wallet = getWalletAddress(req);
  const author = wallet ? await getUserByWallet(wallet) : null;
  if (!author) { res.status(401).json({ error: "Signed member session required." }); return; }
  let content = typeof req.body?.content === "string" ? req.body.content.trim() : "";
  let imageUrl = typeof req.body?.imageUrl === "string" ? req.body.imageUrl : "";
  let isPaid = req.body?.isPaid === true;
  let id = Number(req.body?.legacyPostId);
  if (Number.isSafeInteger(id) && id > 0) {
    const [legacy] = await db.select().from(postsTable).where(eq(postsTable.id, id));
    if (!legacy || legacy.authorId !== author.id) { res.status(403).json({ error: "This pending post is not yours." }); return; }
    if (legacy.chainVerifiedAt) { res.status(409).json({ error: "Post is already published." }); return; }
    content = legacy.content; imageUrl = legacy.imageUrl ?? ""; isPaid = legacy.isPaid;
  } else {
    try { await assertImageBinding(imageUrl, author.id, isPaid ? "private" : "public"); }
    catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Upload an owned image first." }); return; }
    const allocated = await db.execute(sql`select nextval(pg_get_serial_sequence('posts', 'id'))::int as id`);
    id = Number((allocated as unknown as { rows: { id: number }[] }).rows[0].id);
  }
  if (!imageUrl || content.length > 10_000 || !Number.isSafeInteger(id) || id <= 0) {
    res.status(400).json({ error: "An image is required; caption must be at most 10,000 characters." }); return;
  }
  const contentUri = postCommitment(id, author.walletAddress, content, imageUrl, isPaid);
  const [draft] = await db.insert(postDraftsTable).values({ id, authorId: author.id, content, imageUrl, isPaid, contentUri })
    .onConflictDoNothing().returning();
  const saved = draft ?? (await db.select().from(postDraftsTable).where(eq(postDraftsTable.id, id)))[0];
  if (!saved || saved.authorId !== author.id) { res.status(409).json({ error: "Draft belongs to another member." }); return; }
  res.json({ postId: saved.id, contentUri: saved.contentUri, content: saved.content, imageUrl: saved.imageUrl, isPaid: saved.isPaid });
});

router.post("/posts", async (req, res): Promise<void> => {
  const parsed = CreatePostBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const { authorWalletAddress } = parsed.data;
  if (getWalletAddress(req)?.toLowerCase() !== authorWalletAddress.toLowerCase()) {
    res.status(403).json({ error: "Author must match the signed wallet session." }); return;
  }
  const author = await getUserByWallet(authorWalletAddress);
  if (!author) { res.status(404).json({ error: "Author not found" }); return; }
  const postId = parsed.data.postId;
  const txHash = parsed.data.txHash;
  if (!postId || !txHash) { res.status(400).json({ error: "Prepare a draft and confirm its Monad transaction before publishing." }); return; }
  const [existing] = await db.select().from(postsTable).where(eq(postsTable.id, postId));
  if (existing?.chainVerifiedAt && existing.authorId === author.id && existing.onChainTxHash?.toLowerCase() === txHash.toLowerCase()) {
    res.status(200).json({ ...existing, publicationConfirmed: true }); return;
  }
  const [draft] = await db.select().from(postDraftsTable).where(eq(postDraftsTable.id, postId));
  if (!draft || draft.authorId !== author.id) { res.status(403).json({ error: "Prepare an owned draft first." }); return; }
  if (existing && existing.authorId !== author.id) { res.status(409).json({ error: "Post id is already in use." }); return; }
   try {
     try { await verifySocialReceipt("post", txHash, author.walletAddress, postId, draft.contentUri); }
     catch (error) {
       // Historical publications used a managed-image URI rather than the new
       // content hash. Only an existing owned record may use that exact proof.
       const path = existing?.imageUrl ? canonicalObjectPath(existing.imageUrl) : null;
       if (!(error instanceof InvalidReceiptError) || !existing || !path) throw error;
       await verifySocialReceipt("post", txHash, author.walletAddress, postId, `mf:${postId}:${path}`);
     }
   }
  catch (err) {
     const invalid = err instanceof InvalidReceiptError;
     req.log.warn({ postId, error: err instanceof Error ? err.name : "unknown",
       reason: invalid ? (err as Error).message : "RPC verification unavailable" }, "Publication receipt rejected");
     res.status(invalid ? 422 : 503).json({ error: invalid
       ? "This transaction does not match the post. Finish publishing to check its original Monad receipt. No new signature is needed for an already confirmed post."
       : "Monad receipt verification is temporarily unavailable. Your draft and transaction are kept. Retry without signing again." }); return;
  }
  const { content, imageUrl, isPaid } = draft;
  try { if (!existing) await bindNewImage(imageUrl, author.id, isPaid ? "private" : "public"); }
  catch (err) { res.status(400).json({ error: (err as Error).message }); return; }

  const [post] = await db
    .insert(postsTable)
    .values({ id: postId, content, imageUrl, authorId: author.id, isPaid, onChainTxHash: txHash.toLowerCase(), chainVerifiedAt: new Date() })
    .onConflictDoUpdate({ target: postsTable.id, set: { onChainTxHash: txHash.toLowerCase(), chainVerifiedAt: new Date() } })
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
    onChainTxHash: post.onChainTxHash,
    publicationConfirmed: true,
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
  await reconcilePostProofs();
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
      chainVerifiedAt: postsTable.chainVerifiedAt,
      isPaid: postsTable.isPaid,
      authorName: usersTable.name,
      authorUsername: usersTable.username,
      authorAvatarUrl: usersTable.avatarUrl,
      authorNftHolder: usersTable.nftHolder,
      likeCount: sql<number>`(select count(distinct user_id) from post_likes where post_id = ${postsTable.id} and chain_verified_at is not null)::int`,
    })
    .from(postsTable)
    .leftJoin(usersTable, eq(usersTable.id, postsTable.authorId))
    .where(eq(postsTable.id, params.data.postId));

  if (!post) { res.status(404).json({ error: "Post not found" }); return; }
  if (!post.chainVerifiedAt && currentUser?.id !== post.authorId) { res.status(404).json({ error: "Post is not published." }); return; }

  let likedByMe = false;
  let isSubscribedToAuthor = false;
  if (currentUser) {
    const [like] = await db
      .select()
      .from(postLikesTable)
      .where(and(eq(postLikesTable.postId, post.id), eq(postLikesTable.userId, currentUser.id), isNotNull(postLikesTable.chainVerifiedAt)));
    likedByMe = !!like;
    if (currentUser.id === post.authorId) {
      isSubscribedToAuthor = true;
    } else {
      const subs = await getSubscribedAuthorIds(currentUser.id);
      isSubscribedToAuthor = subs.has(post.authorId);
    }
  }
  res.json({ ...post, onChainTxHash: post.chainVerifiedAt ? post.onChainTxHash : null, publicationConfirmed: !!post.chainVerifiedAt, likedByMe, isSubscribedToAuthor });
});

router.delete("/posts/:postId", async (req, res): Promise<void> => {
  res.status(405).json({ error: "Post deletion is disabled for everyone. Published posts and their on-chain records are permanent." });
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

  if (!post.chainVerifiedAt) { res.status(409).json({ error: "This post must be confirmed on Monad before it can receive likes." }); return; }
  const likeTxHash = typeof req.body?.txHash === "string" ? req.body.txHash : null;
  try {
    if (likeTxHash) await verifySocialReceipt("like", likeTxHash, currentUser.walletAddress, post.id);
    else if (!await chainHasLike(post.id, currentUser.walletAddress)) {
      res.status(422).json({ error: "Confirm the like transaction on Monad first." }); return;
    }
  } catch {
    res.status(422).json({ error: "Like is not confirmed on Monad. No off-chain like was saved." }); return;
  }

  const createdLike = await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`like:${post.id}:${currentUser.id}`}, 0))`);
    const [existing] = await tx.select().from(postLikesTable)
      .where(and(eq(postLikesTable.postId, post.id), eq(postLikesTable.userId, currentUser.id)));
    if (existing) {
      await tx.update(postLikesTable).set({ chainVerifiedAt: new Date(), ...(likeTxHash ? { onChainTxHash: likeTxHash } : {}) })
        .where(and(eq(postLikesTable.postId, post.id), eq(postLikesTable.userId, currentUser.id)));
      return false;
    }
    await tx.insert(postLikesTable).values({ postId: post.id, userId: currentUser.id,
      chainVerifiedAt: new Date(),
      ...(likeTxHash ? { onChainTxHash: likeTxHash } : {}) });
    return true;
  });

  if (createdLike) {
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
  if (createdLike) await db.transaction(async (tx) => {
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
    .select({ count: sql<number>`count(distinct user_id)::int` })
    .from(postLikesTable)
    .where(and(eq(postLikesTable.postId, params.data.postId), isNotNull(postLikesTable.chainVerifiedAt)));

  const newLikeCount = countRow?.count ?? 0;
  res.json({ likeCount: newLikeCount, likedByMe: true });

  broadcastActivity({ type: "post_liked", postId: params.data.postId, likeCount: newLikeCount, actorId: currentUser.id });
  void checkAndNotifyTrending(params.data.postId, post.authorId, post.isPaid ? "Exclusive post" : post.content);
  void checkMilestones(post.authorId);
});

router.patch("/posts/:postId/anchor", async (req, res): Promise<void> => {
  res.status(405).json({ error: "Use receipt-verified publication. Unverified anchor updates are disabled." });
});

router.delete("/posts/:postId/like", async (req, res): Promise<void> => {
  res.status(405).json({ error: "Monad registry likes cannot be undone. No unlike transaction exists." });
});

export default router;
