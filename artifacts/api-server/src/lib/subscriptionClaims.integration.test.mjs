import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { db, pool, usersTable, subscriptionQuotesTable, subscriptionPaymentsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { claimSubscriptionQuote } from "./subscriptionClaims.ts";
test("atomic quote claims: concurrent duplicate, hash replay across quotes, identity and rollback", {
  skip: process.env.RUN_DATABASE_TESTS !== "1" || process.env.NODE_ENV === "production",
}, async () => {
  const ids = [];
  try {
    for (let i = 0; i < 2; i++) {
      const [user] = await db.insert(usersTable).values({
        walletAddress: `0x${randomBytes(20).toString("hex")}`, username: `sub_test_${randomBytes(8).toString("hex")}`,
      }).returning();
      ids.push(user.id);
    }
    const issue = async () => (await db.insert(subscriptionQuotesTable).values({
      id: randomUUID(), subscriberId: ids[0], creatorId: ids[1], subscriberWallet: "fixture", creatorWallet: "fixture",
      price: "2", chainId: 143, contract: "fixture", createdAt: new Date(), expiresAt: new Date(Date.now() + 60000),
    }).returning())[0];
    const quote = await issue(), hash = `0x${randomBytes(32).toString("hex")}`;
    const results = await Promise.allSettled(Array.from({ length: 8 }, () =>
      db.transaction(tx => claimSubscriptionQuote(tx, quote, hash))));
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
    const [saved] = await db.select().from(subscriptionQuotesTable).where(eq(subscriptionQuotesTable.id, quote.id));
    assert.equal(saved.consumedHash, hash);
    const otherQuote = await issue();
    await assert.rejects(db.transaction(tx => claimSubscriptionQuote(tx, otherQuote, hash)));
    const [unconsumed] = await db.select().from(subscriptionQuotesTable).where(eq(subscriptionQuotesTable.id, otherQuote.id));
    assert.equal(unconsumed.consumedHash, null, "ledger replay must roll back quote consumption");
    await assert.rejects(db.transaction(tx => claimSubscriptionQuote(tx, { ...otherQuote, creatorId: ids[0] }, hash)), /identity mismatch/);
    await assert.rejects(db.transaction(async tx => {
      await claimSubscriptionQuote(tx, otherQuote, `0x${randomBytes(32).toString("hex")}`);
      throw new Error("grant failed");
    }), /grant failed/);
    const [rolledBack] = await db.select().from(subscriptionQuotesTable).where(eq(subscriptionQuotesTable.id, otherQuote.id));
    assert.equal(rolledBack.consumedHash, null);
  } finally {
    if (ids.length) {
      await db.delete(subscriptionPaymentsTable).where(inArray(subscriptionPaymentsTable.subscriberId, ids));
      await db.delete(subscriptionQuotesTable).where(inArray(subscriptionQuotesTable.subscriberId, ids));
      await db.delete(usersTable).where(inArray(usersTable.id, ids));
    }
    await pool.end();
  }
});