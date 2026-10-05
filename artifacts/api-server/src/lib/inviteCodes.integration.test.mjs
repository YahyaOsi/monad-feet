// Run from workspace root: pnpm --filter @workspace/api-server run test:invites
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import pg from "../../../../lib/db/node_modules/pg/lib/index.js";

test("single-use invites: concurrent claims, rollback, validation and owner status", {
  skip: process.env.RUN_DATABASE_TESTS !== "1" || process.env.NODE_ENV === "production",
}, async () => {
  // Fixture-only development schema. Never reads or edits real user records,
  // and never submits wallet transactions or calls a chain RPC.
  const originalURL = process.env.DATABASE_URL;
  const admin = new pg.Pool({ connectionString: originalURL });
  const schema = `invite_test_${randomBytes(8).toString("hex")}`;
  let appPool, server;
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    for (const table of ["users", "invite_codes"]) {
      await admin.query(`CREATE TABLE "${schema}".${table} (LIKE public.${table} INCLUDING ALL)`);
      await admin.query(`CREATE SEQUENCE "${schema}".${table}_fixture_seq`);
      await admin.query(`ALTER TABLE "${schema}".${table} ALTER COLUMN id SET DEFAULT nextval('"${schema}".${table}_fixture_seq')`);
    }
    const url = new URL(originalURL);
    url.searchParams.set("options", `-c search_path=${schema}`);
    process.env.DATABASE_URL = url.toString();
    const { db, pool, usersTable } = await import("@workspace/db");
    appPool = pool;
    const { consumeInviteCode, isInviteUsed } = await import("./inviteCodes.ts");
    const { default: router } = await import("../routes/invites.ts");
    const { default: express } = await import("express");
    const app = express();
    app.use(express.json(), router);
    server = app.listen(0, "127.0.0.1");
    await new Promise(resolve => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const wallet = () => `0x${randomBytes(20).toString("hex")}`;
    const ownerWallet = wallet();
    const { rows: [owner] } = await pool.query(
      "INSERT INTO users(wallet_address, username) VALUES($1, 'owner') RETURNING id", [ownerWallet]);
    const { rows: [invite] } = await pool.query(
      "INSERT INTO invite_codes(code,owner_id) VALUES('ONCEONLY', $1) RETURNING id", [owner.id]);
    const validate = async code => {
      const response = await fetch(`${base}/invites/validate`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      assert.equal(response.headers.get("cache-control"), "no-store");
      return response.json();
    };
    assert.equal((await validate("  onceonly  ")).valid, true);

    // Eight friends race for the same code. Failed claims roll account inserts
    // back; only one friend and one used marker can survive.
    const attempts = await Promise.allSettled(Array.from({ length: 8 }, (_, i) =>
      db.transaction(async tx => {
        const [user] = await tx.insert(usersTable).values({
          walletAddress: wallet(), username: `friend_${i}`,
        }).returning();
        if (!await consumeInviteCode(tx, invite.id, user.id)) throw new Error("INVITE_USED");
        return user;
      })));
    const winners = attempts.filter(result => result.status === "fulfilled");
    assert.equal(winners.length, 1);
    assert.equal(attempts.filter(result => result.status === "rejected" && result.reason.message === "INVITE_USED").length, 7);
    const { rows: [counts] } = await pool.query("SELECT count(*)::int AS count FROM users WHERE username LIKE 'friend_%'");
    assert.equal(counts.count, 1);
    const { rows: [used] } = await pool.query("SELECT used_by_id,used_at FROM invite_codes WHERE id=$1", [invite.id]);
    assert.equal(used.used_by_id, winners[0].value.id);
    assert.ok(used.used_at);
    assert.equal((await validate("ONCEONLY")).valid, false);
    assert.equal((await validate("ONCEONLY")).message, "Invite code already used");
    assert.equal((await validate("UNKNOWN")).valid, false);

    const ownerResponse = await fetch(`${base}/invites`, { headers: { "x-wallet-address": ownerWallet } });
    assert.equal(ownerResponse.headers.get("cache-control"), "no-store");
    const [ownerCode] = await ownerResponse.json();
    assert.equal(ownerCode.used, true);
    assert.equal(ownerCode.usedByUsername, winners[0].value.username);

    // No burn on a failed signup or profile save.
    const { rows: [retry] } = await pool.query(
      "INSERT INTO invite_codes(code,owner_id) VALUES('RETRYCODE',$1) RETURNING id", [owner.id]);
    await assert.rejects(db.transaction(async tx => {
      const [user] = await tx.insert(usersTable).values({ walletAddress: wallet(), username: "failed_signup" }).returning();
      assert.equal(await consumeInviteCode(tx, retry.id, user.id), true);
      throw new Error("profile save failed");
    }), /profile save failed/);
    assert.equal((await validate("RETRYCODE")).valid, true);
    await db.transaction(async tx => {
      const [user] = await tx.insert(usersTable).values({ walletAddress: wallet(), username: "retried_signup" }).returning();
      assert.equal(await consumeInviteCode(tx, retry.id, user.id), true);
    });
    assert.equal((await validate("RETRYCODE")).valid, false);

    // A timestamp is permanent evidence of use, even without a user link.
    const { rows: [historical] } = await pool.query(
      "INSERT INTO invite_codes(code,owner_id,used_at) VALUES('HISTORY',$1,now()) RETURNING id", [owner.id]);
    assert.equal(isInviteUsed({ usedById: null, usedAt: new Date() }), true);
    assert.equal(isInviteUsed({ usedById: owner.id, usedAt: null }), true);
    assert.equal(isInviteUsed({ usedById: null, usedAt: null }), false);
    assert.equal((await validate("HISTORY")).valid, false);
    assert.equal(await db.transaction(tx => consumeInviteCode(tx, historical.id, owner.id)), false);
    assert.equal(await db.transaction(tx => consumeInviteCode(tx, -1, owner.id)), false);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (appPool) await appPool.end();
    process.env.DATABASE_URL = originalURL;
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  }
});