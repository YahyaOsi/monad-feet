import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import express from "express";
import { eq, inArray } from "drizzle-orm";
import { db, pool, usersTable, postsTable, commentsTable, notificationsTable } from "@workspace/db";
import comments from "../routes/comments.ts";
import { status } from "../routes/daily-bonus.ts";

test("comment threads preserve siblings and reject cross post parents; all daily task queries execute", {
  skip: process.env.RUN_DATABASE_TESTS !== "1" || process.env.NODE_ENV === "production",
}, async () => {
  let user, server;
  const postIds = [];
  try {
    [user] = await db.insert(usersTable).values({ walletAddress: `0x${randomBytes(20).toString("hex")}`,
      username: `thread_test_${randomBytes(8).toString("hex")}` }).returning();
    for (let n = 0; n < 2; n++) {
      const [p] = await db.insert(postsTable).values({ authorId: user.id, content: "Test post" }).returning();
      postIds.push(p.id);
    }
    // Handler tests on an isolated server. Wallet authentication itself is not
    // bypassed in the app and is not claimed as covered by this test.
    const app = express(); app.use(express.json()); app.use(comments);
    server = await new Promise(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const create = async (postId, parentCommentId = null) => {
      const r = await fetch(`${base}/posts/${postId}/comments`, { method: "POST",
        headers: { "Content-Type": "application/json", "x-wallet-address": user.walletAddress },
        body: JSON.stringify({ content: "A test reply", parentCommentId }) });
      return { status: r.status, data: await r.json() };
    };
    const root = await create(postIds[0]); assert.equal(root.status, 201);
    const a = await create(postIds[0], root.data.id);
    const b = await create(postIds[0], root.data.id);
    const nested = await create(postIds[0], a.data.id);
    assert.equal(nested.data.parentCommentId, a.data.id);
    assert.equal((await create(postIds[1], root.data.id)).status, 400);
    const deleted = await fetch(`${base}/comments/${a.data.id}`, { method: "DELETE",
      headers: { "x-wallet-address": user.walletAddress } });
    assert.equal(deleted.status, 204);
    const list = await (await fetch(`${base}/posts/${postIds[0]}/comments`)).json();
    assert.ok(list.some(c => c.id === b.data.id));
    assert.equal(list.find(c => c.id === nested.data.id).parentCommentId, root.data.id);
    for (let day = 0; day < 12; day++) {
      const s = await db.transaction(tx => status(tx, user.id, new Date(Date.UTC(2026, 9, 6 + day))));
      assert.equal(typeof s.progress, "number"); assert.equal(s.claimed, false);
    }
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (user) await db.transaction(async tx => {
      await tx.delete(notificationsTable).where(eq(notificationsTable.userId, user.id));
      if (postIds.length) {
        await tx.delete(commentsTable).where(inArray(commentsTable.postId, postIds));
        await tx.delete(postsTable).where(inArray(postsTable.id, postIds));
      }
      await tx.delete(usersTable).where(eq(usersTable.id, user.id));
    });
    await pool.end();
  }
});
