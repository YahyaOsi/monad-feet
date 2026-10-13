import { and, eq, sql } from "drizzle-orm";
import { db, usersTable, streaksTable, chainRewardClaimsTable } from "@workspace/db";
import { REGISTRY } from "./chainConfig";
import { safeNumber } from "./gameChain";
import { dailyCheckinPoints, utcDay } from "../reward-rules";

export async function saveVerifiedCheckin(
  user: { id: number; nftHolder: boolean }, txHash: string, verified: { timestamp: bigint; streak: number },
) {
  return db.transaction(async tx => {
    await tx.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, user.id)).for("update");
    const [claimed] = await tx.select().from(chainRewardClaimsTable).where(and(
      eq(chainRewardClaimsTable.contractAddress, REGISTRY.toLowerCase()), eq(chainRewardClaimsTable.txHash, txHash)));
    let [streak] = await tx.select().from(streaksTable).where(eq(streaksTable.userId, user.id)).for("update");
    if (!streak) [streak] = await tx.insert(streaksTable).values({ userId: user.id }).returning();
    if (claimed) {
      if (claimed.userId !== user.id || claimed.kind !== "checkin") throw new Error("Transaction already claimed");
      return streak;
    }
    if (!Number.isSafeInteger(verified.streak) || verified.streak < 1) throw new Error("Invalid confirmed streak");
    const at = new Date(safeNumber(verified.timestamp) * 1000);
    const day = utcDay(at);
    // A late receipt still earns its day's points once, but cannot roll the
    // displayed streak back to an older date.
    const claims = await tx.select({ at: chainRewardClaimsTable.blockTimestamp }).from(chainRewardClaimsTable).where(and(
      eq(chainRewardClaimsTable.userId, user.id), eq(chainRewardClaimsTable.kind, "checkin"),
      eq(chainRewardClaimsTable.contractAddress, REGISTRY.toLowerCase())));
    const alreadyCreditedDay = claims.some(c => utcDay(c.at) === day)
      || (streak.lastCheckin !== null && utcDay(streak.lastCheckin) === day);
    const points = alreadyCreditedDay ? 0 : dailyCheckinPoints(verified.streak, user.nftHolder);
    await tx.insert(chainRewardClaimsTable).values({
      contractAddress: REGISTRY.toLowerCase(), txHash, userId: user.id, kind: "checkin",
      pointsAwarded: points, inviteCodes: [], blockTimestamp: at,
    });
    const isNewest = !streak.lastCheckin || at >= streak.lastCheckin;
    const [saved] = await tx.update(streaksTable).set({
      totalPoints: sql`${streaksTable.totalPoints} + ${points}`,
      longestStreak: Math.max(streak.longestStreak, verified.streak),
      ...(isNewest ? { currentStreak: verified.streak, lastCheckin: at, lastCheckinTxHash: txHash } : {}),
    }).where(eq(streaksTable.userId, user.id)).returning();
    return saved;
  });
}
