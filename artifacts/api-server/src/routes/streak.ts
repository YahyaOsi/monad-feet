import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, streaksTable, usersTable, badgesTable, chainRewardClaimsTable } from "@workspace/db";
import { hasChogNft } from "../lib/chog";
import { nanoid } from "nanoid";
import { checkMilestones } from "../milestones";
import { utcDay } from "../reward-rules";
import { REGISTRY } from "../lib/chainConfig";
import { verifyRewardReceipt, InvalidReceiptError } from "../lib/gameChain";
import { grantEarlyBetaBadges } from "../lib/earlyBeta";
import { saveVerifiedCheckin } from "../lib/checkinClaims";
import { recoverLatestCheckin } from "../lib/checkinRecovery";

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

router.get("/streak", async (req, res): Promise<void> => {
  const walletAddress = getWalletAddress(req);
  if (!walletAddress) {
    res.status(400).json({ error: "Please connect your wallet and sign in" });
    return;
  }

  const user = await getUserByWallet(walletAddress);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  let [streak] = await db
    .select()
    .from(streaksTable)
    .where(eq(streaksTable.userId, user.id));

  let syncPending = false;
  try {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        recoverLatestCheckin(user, streak?.lastCheckin ?? null),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Check in sync is still running")), 10_000); }),
      ]);
    } finally { if (timer) clearTimeout(timer); }
    [streak] = await db.select().from(streaksTable).where(eq(streaksTable.userId, user.id));
  } catch (error) {
    syncPending = true;
    req.log.warn({ err: error, userId: user.id }, "Check in recovery could not finish");
  }
  if (!streak) {
    res.json({
      syncPending,
      syncError: syncPending ? "Could not sync your latest check in. Please retry." : null,
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
    syncPending,
    syncError: syncPending ? "Could not sync your latest check in. Please retry." : null,
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
    res.status(400).json({ error: "Please connect your wallet and sign in" });
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
      ? { timestamp: BigInt(Math.floor(previousClaim.blockTimestamp.getTime() / 1000)), streak: 0 }
      : await verifyRewardReceipt("checkin", txHash, user.walletAddress);
  }
  catch (e) {
    res.status(e instanceof InvalidReceiptError ? 422 : 503).json({ error: e instanceof InvalidReceiptError ? e.message : "Could not verify your check in. Retry this hash. Do not pay again." }); return;
  }

  const updated = await saveVerifiedCheckin(user, txHash, verified);

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
  const publicUserId = req.query.userId === undefined ? null : Number(req.query.userId);
  if (publicUserId !== null && (!Number.isSafeInteger(publicUserId) || publicUserId <= 0)) {
    res.status(400).json({ error: "Choose a valid profile" }); return;
  }
  if (!walletAddress && publicUserId === null) {
    res.status(400).json({ error: "Please connect your wallet and sign in" });
    return;
  }

  const user = publicUserId !== null
    ? (await db.select().from(usersTable).where(eq(usersTable.id, publicUserId)))[0]
    : await getUserByWallet(walletAddress!);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  await grantEarlyBetaBadges(user.id);
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

  let chogHolder = false;
  try { chogHolder = await hasChogNft(user.walletAddress); }
  catch { res.status(503).json({ error: "Current holder badges could not be verified. Please retry." }); return; }
  const formatted = badges.map((b) => ({
      id: b.id,
      userId: b.userId,
      badgeType: b.badgeType,
      label: b.label,
      description: b.description,
      creatorId: b.creatorId,
      creatorName: b.creatorName,
      earnedAt: b.earnedAt,
    }));
  res.json([...formatted, ...(chogHolder ? [{
    id: -user.id, userId: user.id, badgeType: "chog_holder", label: "ChogNFT holder badge",
    description: "Currently holds a CHOG Genesis NFT on Monad Mainnet. Rechecked against the collection.",
    creatorId: null, creatorName: null, earnedAt: user.createdAt,
  }] : [])]);
});

export { nanoid };
export default router;
