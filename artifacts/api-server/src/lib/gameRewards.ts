import { and, eq, sql } from "drizzle-orm";
import { db, usersTable, streaksTable, inviteCodesTable, chainRewardClaimsTable, type ChainRewardClaim } from "@workspace/db";
import { nanoid } from "nanoid";
import { REGISTRY } from "./chainConfig";
import { safeNumber } from "./gameChain";

export const gameClaimKey = (hash: string) => and(
  eq(chainRewardClaimsTable.contractAddress, REGISTRY.toLowerCase()), eq(chainRewardClaimsTable.txHash, hash.toLowerCase()),
);
export function gameAward(claim: ChainRewardClaim, alreadyClaimed: boolean) {
  return { alreadyClaimed, pointsAwarded: claim.pointsAwarded, invitesAwarded: claim.inviteCodes.length, inviteCodes: claim.inviteCodes };
}

/** Internal trusted entry point: callers MUST verify the chain receipt first. */
export async function saveVerifiedGameReward(userId: number, hash: string, verified: { points: number; invites: number; timestamp: bigint }) {
  return db.transaction(async (tx) => {
    await tx.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, userId)).for("update");
    const [existing] = await tx.select().from(chainRewardClaimsTable).where(gameClaimKey(hash));
    if (existing) {
      if (existing.userId !== userId || existing.kind !== "game") throw new Error("Transaction already claimed");
      return gameAward(existing, true);
    }
    const codes = Array.from({ length: verified.invites }, () => nanoid(10).toUpperCase());
    const [claim] = await tx.insert(chainRewardClaimsTable).values({
      contractAddress: REGISTRY.toLowerCase(), txHash: hash.toLowerCase(), userId, kind: "game", pointsAwarded: verified.points,
      inviteCodes: codes, blockTimestamp: new Date(safeNumber(verified.timestamp) * 1000),
    }).returning();
    await tx.insert(streaksTable).values({ userId, totalPoints: verified.points })
      .onConflictDoUpdate({ target: streaksTable.userId, set: { totalPoints: sql`${streaksTable.totalPoints} + ${verified.points}` } });
    if (codes.length) await tx.insert(inviteCodesTable).values(codes.map((code) => ({ code, ownerId: userId })));
    return gameAward(claim, false);
  });
}