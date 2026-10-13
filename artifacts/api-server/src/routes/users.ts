import { Router, type IRouter } from "express";
import { bindNewImage, viewerId } from "../lib/contentPrivacy";
import { eq, sql, ilike, or, desc, and, isNull, isNotNull } from "drizzle-orm";
import { db, usersTable, verifiedRegistrationsTable, inviteCodesTable, streaksTable, postsTable, postLikesTable, subscriptionsTable, privatePostsTable } from "@workspace/db";
import {
  RegisterUserBody,
  UpdateMeBody,
  GetUserParams,
} from "@workspace/api-zod";
import { nanoid } from "nanoid";
import { referralPoints } from "../reward-rules";
import { grantEarlyBetaBadges } from "../lib/earlyBeta";
import { hasVerifiedRegistration, allowAttempt } from "../lib/walletAuth";
import { discoverRegistration, verifyRegistration, normalizeRegistrationUsername, isUniqueViolation } from "../lib/registrationChain";
import { consumeInviteCode, isInviteUsed } from "../lib/inviteCodes";
import { hasChogNft, CHOG_COLLECTION } from "../lib/chog";
const router: IRouter = Router();

router.get("/auth/nft-access", async (req, res): Promise<void> => {
  const wallet = getWalletAddress(req);
  if (!wallet) { res.status(401).json({ error: "Sign in with your wallet to check NFT access." }); return; }
  try {
    res.json({ chogHolder: await hasChogNft(wallet, true), collection: CHOG_COLLECTION, chainId: 143, monadFeetNftAvailable: false });
  } catch {
    res.status(503).json({ error: "CHOG ownership could not be checked. Retry; NFT access has not been approved." });
  }
});

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

router.post("/auth/registration/prepare", async (req, res): Promise<void> => {
  const wallet = getWalletAddress(req)?.toLowerCase();
  if (!wallet) { res.status(401).json({ error: "Signed wallet session required", code: "AUTH_REQUIRED" }); return; }
  if (!allowAttempt(`registration-prepare:${wallet}`, 6)) {
    res.status(429).json({ error: "Too many registration checks; retry in a minute", code: "RATE_LIMITED" }); return;
  }
  const username = normalizeRegistrationUsername(req.body?.username);
  if (!username) { res.status(400).json({ error: "Username must contain 3–32 letters, numbers or underscores", code: "INVALID_USERNAME" }); return; }
  try {
    const [existing] = await db.select().from(usersTable).where(eq(usersTable.walletAddress, wallet));
    if (existing) {
      if (!await hasVerifiedRegistration(existing)) {
        res.status(403).json({ error: "Existing account requires receipt-verified migration", code: "UNVERIFIED_ACCOUNT" }); return;
      }
      // Already-admitted accounts must not consume another invite or rename.
      if (!await verifyRegistration(existing.registrationTxHash!, wallet)) {
        res.status(422).json({ error: "Existing registration verification failed", code: "INVALID_REGISTRATION" }); return;
      }
      res.json({ registered: true, txHash: existing.registrationTxHash }); return;
    }
    const [taken] = await db.select().from(usersTable).where(sql`lower(trim(${usersTable.username})) = ${username}`);
    if (taken) { res.status(409).json({ error: "Username already taken", code: "USERNAME_TAKEN" }); return; }
    const code = typeof req.body?.inviteCode === "string" ? req.body.inviteCode.trim().toUpperCase() : "";
    if (code || !await hasChogNft(wallet, true)) {
      const [invite] = await db.select().from(inviteCodesTable).where(eq(inviteCodesTable.code, code));
      if (!invite || isInviteUsed(invite)) {
        res.status(400).json({ error: invite ? "Invite code already used" : "An unused invite or a CHOG Genesis NFT in this wallet is required.", code: invite ? "INVITE_USED" : "INVALID_INVITE" }); return;
      }
    }
    res.json(await discoverRegistration(wallet));
  } catch {
    res.status(503).json({ error: "Registration preparation unavailable; please retry", code: "REGISTRATION_UNAVAILABLE" });
  }
});

router.post("/auth/register", async (req, res): Promise<void> => {
  if (!req.headers["x-wallet-address"]) {
    res.status(401).json({ error: "Signed wallet session required" }); return;
  }
  const parsed = RegisterUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { walletAddress, inviteCode: rawInvite, email, name, avatarUrl, bio } = parsed.data;
  const username = normalizeRegistrationUsername(parsed.data.username);
  const inviteCode = rawInvite.trim().toUpperCase();
  if (!username) {
    res.status(400).json({ error: "Username must contain 3–32 letters, numbers or underscores", code: "INVALID_USERNAME" }); return;
  }
  if (getWalletAddress(req)?.toLowerCase() !== walletAddress.toLowerCase()) {
    res.status(403).json({ error: "Wallet does not match signed session", code: "WALLET_MISMATCH" }); return;
  }
  if (avatarUrl) {
    // Registration has no trusted upload owner yet. Set avatars after signup.
    res.status(400).json({ error: "Set your avatar after registration using a new upload" }); return;
  }
  const registrationTxHash = typeof req.body?.txHash === "string" ? req.body.txHash : null;
  const normalizedWallet = walletAddress.toLowerCase();
  if (!registrationTxHash || !/^0x[0-9a-fA-F]{64}$/.test(registrationTxHash)) {
    res.status(400).json({ error: "Confirmed on-chain registration transaction required" }); return;
  }
  try {
    if (!await verifyRegistration(registrationTxHash, normalizedWallet)) {
      res.status(422).json({ error: "Registration transaction does not match the wallet and Monad registry", code: "INVALID_REGISTRATION" }); return;
    }
  } catch {
    res.status(503).json({ error: "Monad receipt verification unavailable; please retry" }); return;
  }

  // Check for duplicate wallet / username first
  const [existingUser] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.walletAddress, normalizedWallet));
  if (existingUser) {
    if (existingUser.registrationTxHash?.toLowerCase() === registrationTxHash.toLowerCase() &&
        await hasVerifiedRegistration(existingUser)) {
      res.status(200).json(formatUser(existingUser)); return;
    }
    res.status(409).json({ error: "Existing account requires receipt-verified migration", code: "UNVERIFIED_ACCOUNT" });
    return;
  }

  // Existing accounts are recognized by the lookup endpoints; registration is
  // reserved for a new wallet with a valid, unredeemed code.
  let nftHolder = false;
  try { nftHolder = await hasChogNft(normalizedWallet, true); }
  catch {
    if (!inviteCode) { res.status(503).json({ error: "CHOG ownership could not be verified. Please retry." }); return; }
    // A valid invite remains an independent admission route. Do not grant an
    // unverified holder badge during an NFT RPC outage.
  }

  let invite: typeof inviteCodesTable.$inferSelect | null = null;

  if (!nftHolder || inviteCode) {
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
    // Check consumption under the transaction lock, so concurrent successful
    // retries can resolve idempotently rather than fail on their own invite.
    invite = found;
  }

  try {
    const newUser = await db.transaction(async (tx) => {
      // Serialize normalized handles (including legacy mixed-case rows) without
      // changing existing account names or requiring a production migration.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${username}, 0))`);
      const [taken] = await tx.select({ id: usersTable.id }).from(usersTable)
        .where(sql`lower(trim(${usersTable.username})) = ${username}`);
      if (taken) throw new Error("Username already taken");
      // Serialize redemptions of this code. A failed insert rolls back the
      // redemption, points and referral count together.
      if (invite) {
        const [locked] = await tx.select().from(inviteCodesTable)
          .where(eq(inviteCodesTable.id, invite.id)).for("update");
        if (!locked || isInviteUsed(locked)) throw new Error("Invite code already used");
      }
      const [created] = await tx.insert(usersTable).values({
        walletAddress: normalizedWallet, email, name, username, avatarUrl, bio,
        registrationTxHash: registrationTxHash.toLowerCase(), nftHolder,
        admissionMethod: invite ? "invite" : "chog",
      }).returning();
      await tx.insert(verifiedRegistrationsTable).values({
        userId: created.id, txHash: registrationTxHash.toLowerCase(),
      });
      await tx.insert(streaksTable).values({ userId: created.id, totalPoints: 10 });
      if (invite) {
        if (!await consumeInviteCode(tx, invite.id, created.id)) {
          throw new Error("Invite code already used");
        }
        // Serialize referrals for the owner as well, even when distinct invite
        // codes are redeemed concurrently. A redemption is counted exactly once.
        if (invite.ownerId !== null) {
          await tx.select({ id: usersTable.id }).from(usersTable)
            .where(eq(usersTable.id, invite.ownerId)).for("update");
          const [referrals] = await tx.select({ count: sql<number>`count(*)::int` })
            .from(inviteCodesTable)
            .where(and(eq(inviteCodesTable.ownerId, invite.ownerId), sql`${inviteCodesTable.usedById} IS NOT NULL`));
          const bonus = referralPoints(referrals.count);
          await tx.insert(streaksTable).values({ userId: invite.ownerId, totalPoints: bonus })
            .onConflictDoUpdate({
              target: streaksTable.userId,
              set: { totalPoints: sql`${streaksTable.totalPoints} + ${bonus}` },
            });
        }
      }
      return created;
    });
    await grantEarlyBetaBadges(newUser.id);
    res.status(201).json(formatUser(newUser));
  } catch (error) {
    // Another retry may have committed while this request was waiting on locks.
    const [existing] = await db.select().from(usersTable).where(eq(usersTable.walletAddress, normalizedWallet));
    if (existing && existing.registrationTxHash?.toLowerCase() === registrationTxHash.toLowerCase() &&
        await hasVerifiedRegistration(existing)) {
      res.status(200).json(formatUser(existing)); return;
    }
    if (error instanceof Error && error.message === "Username already taken") {
      res.status(409).json({ error: error.message, code: "USERNAME_TAKEN" }); return;
    }
    if (error instanceof Error && error.message === "Invite code already used") {
      res.status(409).json({ error: error.message, code: "INVITE_USED" }); return;
    }
    if (isUniqueViolation(error)) {
      res.status(409).json({ error: "Wallet or username already registered", code: "REGISTRATION_CONFLICT" }); return;
    }
    throw error;
  }
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
  if (!await hasVerifiedRegistration(user)) {
    res.status(403).json({ error: "Verified on-chain registration required. Existing accounts require explicit receipt-verified migration." });
    return;
  }

  try {
    const nftHolder = await hasChogNft(user.walletAddress);
    if (user.admissionMethod === "chog" && !nftHolder) {
      res.status(403).json({ error: "This account joined through CHOG access. Hold a CHOG Genesis NFT in this wallet to access member features.", code: "CHOG_REQUIRED" }); return;
    }
    res.json(formatUser({ ...user, nftHolder }));
  } catch {
    if (user.admissionMethod === "chog") res.status(503).json({ error: "NFT ownership check is unavailable. Please retry." });
    else res.json(formatUser({ ...user, nftHolder: false }));
  }
});

router.put("/users/me", async (req, res): Promise<void> => {
  const parsed = UpdateMeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { walletAddress, name, username: rawUsername, avatarUrl, bio } = parsed.data;
  const username = rawUsername == null ? rawUsername : normalizeRegistrationUsername(rawUsername);
  if (rawUsername != null && !username) {
    res.status(400).json({ error: "Username must contain 3–32 letters, numbers or underscores", code: "INVALID_USERNAME" }); return;
  }
  if (avatarUrl) {
    const [owner] = await db.select().from(usersTable).where(eq(usersTable.walletAddress, walletAddress.toLowerCase()));
    if (!owner) { res.status(404).json({ error: "User not found" }); return; }
    // Unchanged legacy avatars are not a new ownership claim.
    if (avatarUrl !== owner.avatarUrl) {
      try { await bindNewImage(avatarUrl, owner.id, "public"); }
      catch (err) { res.status(400).json({ error: (err as Error).message }); return; }
    }
  }

  let user;
  try {
    [user] = await db.transaction(async tx => {
      if (username) {
        // Profile edits must participate in the same lock as registration.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${username}, 0))`);
        const [taken] = await tx.select().from(usersTable)
          .where(sql`lower(trim(${usersTable.username})) = ${username} AND ${usersTable.walletAddress} <> ${walletAddress.toLowerCase()}`);
        if (taken) throw new Error("Username already taken");
      }
      return tx.update(usersTable).set({ name, username, avatarUrl, bio })
        .where(eq(usersTable.walletAddress, walletAddress.toLowerCase())).returning();
    });
  } catch (error) {
    if (isUniqueViolation(error) || (error instanceof Error && error.message === "Username already taken")) {
      res.status(409).json({ error: "Username already taken", code: "USERNAME_TAKEN" }); return;
    }
    throw error;
  }

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
  // Financial analytics and subscriber identities belong only to this owner.
  // Resolve identity from protectApi's signed session before target queries.
  if (await viewerId(req) !== userId) {
    res.status(403).json({ error: "Analytics are available only to their owner" }); return;
  }

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

  // Weekly subscriber growth + revenue for the last 12 weeks
  const growthRaw = await db.execute(sql`
    WITH weeks AS (
      SELECT generate_series(
        date_trunc('week', now() - interval '11 weeks'),
        date_trunc('week', now()),
        interval '1 week'
      ) AS week_start
    )
    SELECT
      to_char(w.week_start, 'Mon DD') AS week,
      COALESCE(COUNT(s.id), 0)::int AS "newSubscribers",
      COALESCE(SUM(s.price_per_month::numeric), 0)::float AS "monEarned"
    FROM weeks w
    LEFT JOIN subscriptions s
      ON date_trunc('week', s.created_at) = w.week_start
      AND s.creator_id = ${userId}
    GROUP BY w.week_start
    ORDER BY w.week_start
  `);

  type GrowthRow = { week: string; newSubscribers: number; monEarned: number };
  const growthRows = Array.isArray(growthRaw)
    ? (growthRaw as unknown as GrowthRow[])
    : ((growthRaw as unknown as { rows?: GrowthRow[] }).rows ?? []);

  res.json({
    userId,
    totalSubscribers: totalSubs,
    activeSubscribers: activeSubs,
    totalRevenueMon: totalSubs * pricePerMonth,
    monthlyRevenueMon: activeSubs * pricePerMonth,
    totalPosts: totalPostRow?.count ?? 0,
    privatePosts: privatePostRow?.count ?? 0,
    totalLikes: likesRow?.count ?? 0,
    subscriberGrowth: growthRows.map((r) => ({ week: r.week, newSubscribers: Number(r.newSubscribers), monEarned: Number(r.monEarned) })),
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
    .where(and(eq(postsTable.authorId, user.id), isNotNull(postsTable.chainVerifiedAt)));

  const [likesResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(postLikesTable)
    .innerJoin(postsTable, eq(postsTable.id, postLikesTable.postId))
    .where(and(eq(postsTable.authorId, user.id), isNotNull(postsTable.chainVerifiedAt), isNotNull(postLikesTable.chainVerifiedAt)));

  const [streak] = await db
    .select()
    .from(streaksTable)
    .where(eq(streaksTable.userId, user.id));

  res.json(formatUser({
    ...user,
    email: (await viewerId(req)) === user.id ? user.email : null,
    postCount: postCountResult?.count ?? 0,
    totalLikes: likesResult?.count ?? 0,
    streakPoints: streak?.totalPoints ?? 0,
    currentStreak: streak?.currentStreak ?? 0,
  }));
});

export default router;
