import { test } from "node:test";
import { strict as assert } from "node:assert";
import { randomBytes } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db, pool, usersTable, streaksTable, inviteCodesTable, chainRewardClaimsTable } from "@workspace/db";
import { saveVerifiedGameReward } from "./gameRewards.ts";
import { REGISTRY } from "./chainConfig.ts";

test("isolated DB awards: concurrent replay, distinct hashes, rollback and cross-wallet rejection", {
  skip: process.env.RUN_DATABASE_TESTS !== "1" || process.env.NODE_ENV === "production",
}, async () => {
  const ids = [];
  try {
    for (let i = 0; i < 2; i++) {
      const [user] = await db.insert(usersTable).values({
        walletAddress: `0x${randomBytes(20).toString("hex")}`,
        username: `game_test_${randomBytes(8).toString("hex")}`,
      }).returning();
      ids.push(user.id);
    }
    const hash = `0x${randomBytes(32).toString("hex")}`;
    const verified = { points: 80, invites: 1, timestamp: 1790726400n };
    const legacyHash = `0x${randomBytes(32).toString("hex")}`;
    await db.insert(chainRewardClaimsTable).values({
      contractAddress: REGISTRY.toLowerCase(), txHash: legacyHash, userId: ids[1],
      kind: "game", actionType: 1, pointsAwarded: 80, inviteCodes: [],
      blockTimestamp: new Date(Number(verified.timestamp) * 1000),
    });
    await db.insert(streaksTable).values({ userId: ids[1], totalPoints: 80 });
    assert.equal((await saveVerifiedGameReward(ids[1], legacyHash, verified)).pointsAwarded, 80);
    assert.equal((await db.select().from(streaksTable).where(eq(streaksTable.userId, ids[1])))[0].totalPoints, 80);
    const results = await Promise.all(Array.from({ length: 12 }, () => saveVerifiedGameReward(ids[0], hash, verified)));
    assert.equal(results.filter(r => !r.alreadyClaimed).length, 1);
    assert.equal(new Set(results.map(r => r.inviteCodes[0])).size, 1);
    let [streak] = await db.select().from(streaksTable).where(eq(streaksTable.userId, ids[0]));
    assert.equal(streak.totalPoints, 10);
    assert.equal((await db.select().from(inviteCodesTable).where(eq(inviteCodesTable.ownerId, ids[0]))).length, 0);
    await assert.rejects(saveVerifiedGameReward(ids[1], hash, verified), /already claimed/);

    await Promise.all(Array.from({ length: 6 }, () => saveVerifiedGameReward(ids[0],
      `0x${randomBytes(32).toString("hex")}`, { ...verified, points: 5, invites: 0 })));
    [streak] = await db.select().from(streaksTable).where(eq(streaksTable.userId, ids[0]));
    assert.equal(streak.totalPoints, 40);
    // Overflow only this isolated user's balance, after receipt insertion: the entire award must roll back.
    await db.update(streaksTable).set({ totalPoints: 9_999_999_999_999 }).where(eq(streaksTable.userId, ids[0]));
    const badHash = `0x${randomBytes(32).toString("hex")}`;
    await assert.rejects(saveVerifiedGameReward(ids[0], badHash, verified));
    assert.equal((await db.select().from(chainRewardClaimsTable).where(eq(chainRewardClaimsTable.txHash, badHash))).length, 0);
    assert.equal((await db.select().from(chainRewardClaimsTable).where(eq(chainRewardClaimsTable.userId, ids[0]))).length, 7);
  } finally {
    if (ids.length) await db.transaction(async tx => {
      await tx.delete(chainRewardClaimsTable).where(inArray(chainRewardClaimsTable.userId, ids));
      await tx.delete(inviteCodesTable).where(inArray(inviteCodesTable.ownerId, ids));
      await tx.delete(streaksTable).where(inArray(streaksTable.userId, ids));
      await tx.delete(usersTable).where(inArray(usersTable.id, ids));
    });
    await pool.end();
  }
});