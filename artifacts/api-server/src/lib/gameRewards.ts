import { and, eq, sql } from "drizzle-orm";
import { db, usersTable, streaksTable, inviteCodesTable, chainRewardClaimsTable, type ChainRewardClaim } from "@workspace/db";
import { nanoid } from "nanoid";
import { REGISTRY } from "./chainConfig";
import { safeNumber } from "./gameChain";
import { gameInviteAward, inferGameAction } from "./gameInviteRules";
import { spaAppPoints } from "./spaPointRules";

export const gameClaimKey = (hash: string) => and(
  eq(chainRewardClaimsTable.contractAddress, REGISTRY.toLowerCase()), eq(chainRewardClaimsTable.txHash, hash.toLowerCase()),
);
export function gameAward(claim: ChainRewardClaim, alreadyClaimed: boolean) {
  return { alreadyClaimed, pointsAwarded: claim.pointsAwarded, invitesAwarded: claim.inviteCodes.length, inviteCodes: claim.inviteCodes };
}

/** Internal trusted entry point: callers MUST verify the chain receipt first. */
export async function saveVerifiedGameReward(userId: number, hash: string, verified: { points: number; invites: number; timestamp: bigint; actionType?: number | null }) {
  return db.transaction(async (tx) => {
    await tx.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, userId)).for("update");
    const [existing] = await tx.select().from(chainRewardClaimsTable).where(gameClaimKey(hash));
    if (existing) {
      if (existing.userId !== userId || existing.kind !== "game") throw new Error("Transaction already claimed");
      return gameAward(existing, true);
    }
    const actionType = verified.actionType ?? inferGameAction(verified.points);
    if (!actionType) throw new Error("Unknown game action");
    const pointsAwarded = spaAppPoints(actionType, verified.points);
    const previous = await tx.select({ points: chainRewardClaimsTable.pointsAwarded, action: chainRewardClaimsTable.actionType })
      .from(chainRewardClaimsTable).where(and(eq(chainRewardClaimsTable.userId, userId),
        eq(chainRewardClaimsTable.contractAddress, REGISTRY.toLowerCase()), eq(chainRewardClaimsTable.kind, "game")));
    const purchaseCount = previous.filter(p => (p.action ?? inferGameAction(p.points)) === actionType).length + 1;
    // App invitation codes use the per action schedule, not the legacy contract event.
    // Old awarded codes and points remain valid. The original contract points
    // establish the purchase ordinal; app points use the new fair schedule.
    const codes = Array.from({ length: gameInviteAward(actionType, purchaseCount) }, () => nanoid(10).toUpperCase());
    const [claim] = await tx.insert(chainRewardClaimsTable).values({
      contractAddress: REGISTRY.toLowerCase(), txHash: hash.toLowerCase(), userId, kind: "game", actionType, pointsAwarded,
      inviteCodes: codes, blockTimestamp: new Date(safeNumber(verified.timestamp) * 1000),
    }).returning();
    await tx.insert(streaksTable).values({ userId, totalPoints: pointsAwarded })
      .onConflictDoUpdate({ target: streaksTable.userId, set: { totalPoints: sql`${streaksTable.totalPoints} + ${pointsAwarded}` } });
    if (codes.length) await tx.insert(inviteCodesTable).values(codes.map((code) => ({ code, ownerId: userId })));
    return gameAward(claim, false);
  });
}