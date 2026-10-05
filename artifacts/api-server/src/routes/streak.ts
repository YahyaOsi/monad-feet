import { Router, type IRouter } from "express";
import { and, eq, sql } from "drizzle-orm";
import { db, streaksTable, usersTable, badgesTable, chainRewardClaimsTable } from "@workspace/db";
import { nanoid } from "nanoid";
import { checkMilestones } from "../milestones";
import { dailyCheckinPoints, utcDay, previousUtcDay } from "../reward-rules";
import { REGISTRY } from "../lib/chainConfig";
import { verifyRewardReceipt, InvalidReceiptError, safeNumber } from "../lib/gameChain";

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
  return utcDay(date) === utcDay(new Date());
}

function isYesterday(date: Date): boolean {
  return utcDay(date) === previousUtcDay(new Date());
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

  const txHash = typeof req.body?.txHash === "string" ? req.body.txHash.toLowerCase() : "";
  const [previousClaim] = await db.select().from(chainRewardClaimsTable).where(and(
    eq(chainRewardClaimsTable.contractAddress, REGISTRY.toLowerCase()), eq(chainRewardClaimsTable.txHash, txHash),
  ));
  if (previousClaim && (previousClaim.userId !== user.id || previousClaim.kind !== "checkin")) {
    res.status(409).json({ error: "Transaction already claimed by another wallet or action" }); return;
  }
  let verified;
  try {
    verified = previousClaim
      ? { timestamp: BigInt(Math.floor(previousClaim.blockTimestamp.getTime() / 1000)) }
      : await verifyRewardReceipt("checkin", txHash, user.walletAddress);
  }
  catch (e) {
    res.status(e instanceof InvalidReceiptError ? 422 : 503).json({ error: e instanceof InvalidReceiptError ? e.message : "Monad check-in verification unavailable; retry this hash, not the payment" }); return;
  }

  const updated = await db.transaction(async (tx) => {
  await tx.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, user.id)).for("update");
  const [claimed] = await tx.select().from(chainRewardClaimsTable).where(and(
    eq(chainRewardClaimsTable.contractAddress, REGISTRY.toLowerCase()), eq(chainRewardClaimsTable.txHash, txHash),
  ));
  let [streak] = await tx
    .select()
    .from(streaksTable)
    .where(eq(streaksTable.userId, user.id)).for("update");

  if (!streak) {
    [streak] = await tx
      .insert(streaksTable)
      .values({ userId: user.id })
      .returning();
  }

  if (claimed) {
    if (claimed.userId !== user.id || claimed.kind !== "checkin") throw new Error("Transaction already claimed");
    return streak;
  }
  const now = new Date(safeNumber(verified.timestamp) * 1000);
  const lastCheckin = streak.lastCheckin ? new Date(streak.lastCheckin) : null;

  // Preserve chronology when receipts are submitted late, and never credit a UTC day twice.
  if (lastCheckin && utcDay(lastCheckin) >= utcDay(now)) {
    await tx.insert(chainRewardClaimsTable).values({
      contractAddress: REGISTRY.toLowerCase(), txHash, userId: user.id, kind: "checkin",
      pointsAwarded: 0, inviteCodes: [], blockTimestamp: now,
    });
    return streak;
  }

  const isConsecutive = lastCheckin ? utcDay(lastCheckin) === previousUtcDay(now) : false;
  const newStreak = isConsecutive ? streak.currentStreak + 1 : 1;
  const newLongest = Math.max(newStreak, streak.longestStreak);
  const pointsEarned = dailyCheckinPoints(newStreak, user.nftHolder);
  // App check-in bonuses remain separate from the contract's 5/10/20 chain points.
  await tx.insert(chainRewardClaimsTable).values({
    contractAddress: REGISTRY.toLowerCase(), txHash, userId: user.id, kind: "checkin",
    pointsAwarded: pointsEarned, inviteCodes: [], blockTimestamp: now,
  });
  const [saved] = await tx
    .update(streaksTable)
    .set({
      currentStreak: newStreak,
      longestStreak: newLongest,
      totalPoints: sql`${streaksTable.totalPoints} + ${pointsEarned}`,
      lastCheckin: now,
      ...(txHash ? { lastCheckinTxHash: txHash } : {}),
    })
    .where(eq(streaksTable.userId, user.id)).returning();
  return saved;
  });

  await checkMilestones(user.id);
  const [finalStreak] = await db.select().from(streaksTable).where(eq(streaksTable.userId, user.id));

  res.json({
    userId: user.id,
    currentStreak: updated.currentStreak,
    longestStreak: updated.longestStreak,
    totalPoints: finalStreak.totalPoints,
    lastCheckin: updated.lastCheckin,
    checkedInToday: updated.lastCheckin ? isToday(updated.lastCheckin) : false,
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
