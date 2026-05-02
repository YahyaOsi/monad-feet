import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, streaksTable, usersTable, inviteCodesTable, badgesTable } from "@workspace/db";
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

function isToday(date: Date): boolean {
  const now = new Date();
  return (
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear()
  );
}

function isYesterday(date: Date): boolean {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return (
    date.getDate() === yesterday.getDate() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getFullYear() === yesterday.getFullYear()
  );
}

router.get("/streak", async (req, res): Promise<void> => {
  const walletAddress = getWalletAddress(req);
  if (!walletAddress) {
    res.status(400).json({ error: "Missing x-wallet-address header" });
    return;
  }

  const user = await getUserByWallet(walletAddress);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const [streak] = await db
    .select()
    .from(streaksTable)
    .where(eq(streaksTable.userId, user.id));

  if (!streak) {
    res.json({
      userId: user.id,
      currentStreak: 0,
      longestStreak: 0,
      totalPoints: 0,
      lastCheckin: null,
      checkedInToday: false,
      extraInviteEarned: false,
      lastCheckinTxHash: null,
    });
    return;
  }

  const checkedInToday = streak.lastCheckin ? isToday(new Date(streak.lastCheckin)) : false;

  res.json({
    userId: user.id,
    currentStreak: streak.currentStreak,
    longestStreak: streak.longestStreak,
    totalPoints: streak.totalPoints,
    lastCheckin: streak.lastCheckin,
    checkedInToday,
    extraInviteEarned: streak.extraInviteEarned,
    lastCheckinTxHash: streak.lastCheckinTxHash,
  });
});

router.post("/streak/checkin", async (req, res): Promise<void> => {
  const walletAddress = getWalletAddress(req);
  if (!walletAddress) {
    res.status(400).json({ error: "Missing x-wallet-address header" });
    return;
  }

  const user = await getUserByWallet(walletAddress);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  // Optional on-chain tx hash from dailyCheckin() call on Monad
  const txHash = typeof req.body?.txHash === "string" ? req.body.txHash : null;

  let [streak] = await db
    .select()
    .from(streaksTable)
    .where(eq(streaksTable.userId, user.id));

  if (!streak) {
    [streak] = await db
      .insert(streaksTable)
      .values({ userId: user.id })
      .returning();
  }

  const now = new Date();
  const lastCheckin = streak.lastCheckin ? new Date(streak.lastCheckin) : null;

  if (lastCheckin && isToday(lastCheckin)) {
    res.json({
      userId: user.id,
      currentStreak: streak.currentStreak,
      longestStreak: streak.longestStreak,
      totalPoints: streak.totalPoints,
      lastCheckin: streak.lastCheckin,
      checkedInToday: true,
      extraInviteEarned: streak.extraInviteEarned,
      lastCheckinTxHash: streak.lastCheckinTxHash,
    });
    return;
  }

  const isConsecutive = lastCheckin ? isYesterday(lastCheckin) : false;
  const newStreak = isConsecutive ? streak.currentStreak + 1 : 1;
  const newLongest = Math.max(newStreak, streak.longestStreak);
  const pointsEarned = newStreak >= 7 ? 20 : newStreak >= 3 ? 10 : 5;
  const newPoints = streak.totalPoints + pointsEarned;

  await db
    .update(streaksTable)
    .set({
      currentStreak: newStreak,
      longestStreak: newLongest,
      totalPoints: newPoints,
      lastCheckin: now,
      ...(txHash ? { lastCheckinTxHash: txHash } : {}),
    })
    .where(eq(streaksTable.userId, user.id));

  const [updated] = await db
    .select()
    .from(streaksTable)
    .where(eq(streaksTable.userId, user.id));

  // Award bonus invite for 5-day like streak (handled in posts route)
  // but also check here for invite generation if needed

  res.json({
    userId: user.id,
    currentStreak: updated.currentStreak,
    longestStreak: updated.longestStreak,
    totalPoints: updated.totalPoints,
    lastCheckin: updated.lastCheckin,
    checkedInToday: true,
    extraInviteEarned: updated.extraInviteEarned,
    lastCheckinTxHash: updated.lastCheckinTxHash,
  });
});

router.get("/badges", async (req, res): Promise<void> => {
  const walletAddress = getWalletAddress(req);
  if (!walletAddress) {
    res.status(400).json({ error: "Missing x-wallet-address header" });
    return;
  }

  const user = await getUserByWallet(walletAddress);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const badges = await db
    .select({
      id: badgesTable.id,
      userId: badgesTable.userId,
      badgeType: badgesTable.badgeType,
      label: badgesTable.label,
      description: badgesTable.description,
      creatorId: badgesTable.creatorId,
      earnedAt: badgesTable.earnedAt,
      creatorName: usersTable.name,
    })
    .from(badgesTable)
    .leftJoin(usersTable, eq(usersTable.id, badgesTable.creatorId))
    .where(eq(badgesTable.userId, user.id));

  res.json(
    badges.map((b) => ({
      id: b.id,
      userId: b.userId,
      badgeType: b.badgeType,
      label: b.label,
      description: b.description,
      creatorId: b.creatorId,
      creatorName: b.creatorName,
      earnedAt: b.earnedAt,
    }))
  );
});

export { nanoid };
export default router;
