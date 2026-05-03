import { Router, type IRouter } from "express";
import { eq, sql, ilike, or, desc } from "drizzle-orm";
import { db, usersTable, inviteCodesTable, streaksTable, postsTable, postLikesTable, subscriptionsTable, privatePostsTable } from "@workspace/db";
import {
  RegisterUserBody,
  UpdateMeBody,
  GetUserParams,
} from "@workspace/api-zod";
import { nanoid } from "nanoid";
import { createPublicClient, http, defineChain } from "viem";

const monadMainnet = defineChain({
  id: 143,
  name: "Monad Mainnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.monad.xyz"] } },
});

const NFT_CONTRACT = "0x656b1011a20b826f7c4ce1a07e5f350a52a3711d" as const;
const ERC721_BALANCE_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const publicClient = createPublicClient({
  chain: monadMainnet,
  transport: http("https://rpc.monad.xyz"),
});

async function hasMonadFeetNft(wallet: string): Promise<boolean> {
  try {
    const balance = await publicClient.readContract({
      address: NFT_CONTRACT,
      abi: ERC721_BALANCE_ABI,
      functionName: "balanceOf",
      args: [wallet as `0x${string}`],
    });
    return balance > 0n;
  } catch {
    return false;
  }
}

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
    nftHolder: user.nftHolder,
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
  const normalizedWallet = walletAddress.toLowerCase();

  // Check for duplicate wallet / username first
  const [existingUser] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.walletAddress, normalizedWallet));
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

  // Determine access path: NFT holder OR valid invite code
  const nftHolder = await hasMonadFeetNft(normalizedWallet);

  let invite: typeof inviteCodesTable.$inferSelect | null = null;

  if (!nftHolder) {
    // Must supply a valid, unused invite code
    if (!inviteCode) {
      res.status(400).json({ error: "An invite code is required to join." });
      return;
    }
    const [found] = await db
      .select()
      .from(inviteCodesTable)
      .where(eq(inviteCodesTable.code, inviteCode.toUpperCase()));

    if (!found) {
      res.status(400).json({ error: "Invalid invite code" });
      return;
    }
    if (found.usedById !== null) {
      res.status(400).json({ error: "Invite code already used" });
      return;
    }
    invite = found;
  }

  // Create the user
  const [newUser] = await db
    .insert(usersTable)
    .values({
      walletAddress: normalizedWallet,
      email,
      name,
      username,
      avatarUrl,
      registrationTxHash,
      nftHolder,
    })
    .returning();

  // Mark invite as used (invite-code path only)
  if (invite) {
    await db
      .update(inviteCodesTable)
      .set({ usedById: newUser.id, usedAt: new Date() })
      .where(eq(inviteCodesTable.id, invite.id));
  }

  // Everyone gets 2 invite codes to share
  const code1 = nanoid(10).toUpperCase();
  const code2 = nanoid(10).toUpperCase();
  await db.insert(inviteCodesTable).values([
    { code: code1, ownerId: newUser.id },
    { code: code2, ownerId: newUser.id },
  ]);

  await db.insert(streaksTable).values({ userId: newUser.id });

  res.status(201).json({ ...formatUser({ ...newUser }), nftHolder });
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
