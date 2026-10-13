import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db, pool, usersTable, streaksTable, chainRewardClaimsTable, inviteCodesTable, badgesTable } from "@workspace/db";
import { saveVerifiedCheckin } from "./checkinClaims.ts";
import { saveVerifiedGameReward } from "./gameRewards.ts";
import { grantEarlyBetaBadges } from "./earlyBeta.ts";

test("isolated reward transactions preserve streaks, prevent replay and enforce invite cadence and badge cutoff", {
  skip: process.env.RUN_DATABASE_TESTS !== "1" || process.env.NODE_ENV === "production",
}, async () => {
  const ids = [];
  const hash = () => `0x${randomBytes(32).toString("hex")}`;
  try {
    for (const createdAt of [new Date("2026-10-09T23:59:59Z"), new Date("2026-10-10T00:00:00Z")]) {
      const [u] = await db.insert(usersTable).values({ walletAddress: `0x${randomBytes(20).toString("hex")}`,
        username: `update_test_${randomBytes(8).toString("hex")}`, createdAt }).returning();
      ids.push(u.id);
    }
    const user = { id: ids[0], nftHolder: false };
    const txHash = hash();
    await Promise.all(Array.from({ length: 5 }, () => saveVerifiedCheckin(user, txHash, { timestamp: 1791244800n, streak: 8 })));
    let [s] = await db.select().from(streaksTable).where(eq(streaksTable.userId, user.id));
    assert.equal(s.currentStreak, 8); assert.equal(s.totalPoints, 10);
    await saveVerifiedCheckin(user, hash(), { timestamp: 1791158400n, streak: 7 });
    [s] = await db.select().from(streaksTable).where(eq(streaksTable.userId, user.id));
    assert.equal(s.currentStreak, 8); assert.equal(s.totalPoints, 20);
    await assert.rejects(saveVerifiedCheckin({ id: ids[1], nftHolder: false }, txHash, { timestamp: 1791244800n, streak: 8 }));
    for (const [actionType, points, count] of [[1, 5, 10], [2, 7, 7], [3, 15, 3]]) {
      const results = await Promise.all(Array.from({ length: count }, () => saveVerifiedGameReward(user.id, hash(),
        { points, invites: 1, timestamp: 1791244800n, actionType })));
      assert.equal(results.reduce((sum, r) => sum + r.invitesAwarded, 0), actionType === 1 ? 0 : 1);
    }
    await Promise.all([grantEarlyBetaBadges(ids[0]), grantEarlyBetaBadges(ids[0]), grantEarlyBetaBadges(ids[1])]);
    assert.equal((await db.select().from(badgesTable).where(eq(badgesTable.userId, ids[0]))).length, 1);
    assert.equal((await db.select().from(badgesTable).where(eq(badgesTable.userId, ids[1]))).length, 0);
  } finally {
    if (ids.length) await db.transaction(async tx => {
      for (const table of [chainRewardClaimsTable, streaksTable, badgesTable]) await tx.delete(table).where(inArray(table.userId, ids));
      await tx.delete(inviteCodesTable).where(inArray(inviteCodesTable.ownerId, ids));
      await tx.delete(usersTable).where(inArray(usersTable.id, ids));
    });
    await pool.end();
  }
});
