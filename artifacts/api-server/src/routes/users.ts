import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, usersTable, inviteCodesTable, streaksTable, postsTable, postLikesTable } from "@workspace/db";
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

router.post("/auth/register", async (req, res): Promise<void> => {
  const parsed = RegisterUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { walletAddress, inviteCode, email, name, username, avatarUrl } = parsed.data;

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
    .values({ walletAddress: walletAddress.toLowerCase(), email, name, username, avatarUrl })
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

  res.status(201).json({
    id: newUser.id,
    walletAddress: newUser.walletAddress,
    email: newUser.email,
    name: newUser.name,
    username: newUser.username,
    avatarUrl: newUser.avatarUrl,
    bio: newUser.bio,
    subscriptionPrice: newUser.subscriptionPrice ? Number(newUser.subscriptionPrice) : null,
    createdAt: newUser.createdAt,
  });
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

  res.json({
    id: user.id,
    walletAddress: user.walletAddress,
    email: user.email,
    name: user.name,
    username: user.username,
    avatarUrl: user.avatarUrl,
    bio: user.bio,
    subscriptionPrice: user.subscriptionPrice ? Number(user.subscriptionPrice) : null,
    createdAt: user.createdAt,
  });
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

  res.json({
    id: user.id,
    walletAddress: user.walletAddress,
    email: user.email,
    name: user.name,
    username: user.username,
    avatarUrl: user.avatarUrl,
    bio: user.bio,
    subscriptionPrice: user.subscriptionPrice ? Number(user.subscriptionPrice) : null,
    createdAt: user.createdAt,
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

  const postCountResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(postsTable)
    .where(eq(postsTable.authorId, user.id));

  const likesResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(postLikesTable)
    .innerJoin(postsTable, eq(postsTable.id, postLikesTable.postId))
    .where(eq(postsTable.authorId, user.id));

  const [streak] = await db
    .select()
    .from(streaksTable)
    .where(eq(streaksTable.userId, user.id));

  res.json({
    id: user.id,
    walletAddress: user.walletAddress,
    email: user.email,
    name: user.name,
    username: user.username,
    avatarUrl: user.avatarUrl,
    bio: user.bio,
    subscriptionPrice: user.subscriptionPrice ? Number(user.subscriptionPrice) : null,
    createdAt: user.createdAt,
    postCount: postCountResult[0]?.count ?? 0,
    totalLikes: likesResult[0]?.count ?? 0,
    streakPoints: streak?.totalPoints ?? 0,
    currentStreak: streak?.currentStreak ?? 0,
  });
});

export default router;
