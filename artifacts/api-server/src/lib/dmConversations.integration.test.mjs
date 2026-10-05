// Run: pnpm --filter @workspace/api-server run test:dm
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { PgDialect } from "drizzle-orm/pg-core";
import pg from "../../../../lib/db/node_modules/pg/lib/index.js";

test("DM production handlers and PostgreSQL regression (rollback only, no server)", {
  skip: process.env.RUN_DATABASE_TESTS !== "1" || process.env.NODE_ENV === "production",
}, async t => {
  assert.ok(process.env.DATABASE_URL, "Development DATABASE_URL is required");
  process.env.LOG_LEVEL = "silent";
  const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const client = await admin.connect();
  let appPool, originalQuery, originalConnect;
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL search_path = pg_temp");
    // Shadow all accessed tables using the real schema, never production/data.
    // Temp sequences ensure tests do not advance development serial sequences.
    const tables = ["users", "direct_messages", "muted_users", "blocked_users",
      "subscriptions", "subscription_payments", "notifications", "wallet_sessions", "verified_registrations"];
    for (const table of tables) {
      await client.query(`CREATE TEMP TABLE "${table}" (LIKE public."${table}" INCLUDING ALL)`);
      const { rows: serials } = await client.query(
        "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_default LIKE 'nextval%'",
        [table],
      );
      for (const { column_name: column } of serials) {
        assert.match(column, /^[a-z_][a-z0-9_]*$/);
        const sequence = `${table}_${column}_dm_test_seq`;
        await client.query(`CREATE TEMP SEQUENCE "${sequence}"`);
        await client.query(`ALTER TABLE "${table}" ALTER COLUMN "${column}" SET DEFAULT nextval('pg_temp.${sequence}')`);
      }
    }
    const { db, pool } = await import("@workspace/db");
    appPool = pool;
    originalQuery = pool.query;
    originalConnect = pool.connect;
    // Every real handler/helper/auth query runs on this single rollback session.
    // No HTTP server, workflow, browser, chain RPC or production access is used.
    pool.query = (...args) => client.query(...args);
    const sendOperations = [];
    let transactionActive = false;
    // Production uses db.transaction's real node-postgres begin/commit path.
    // Translate only its boundaries into savepoints so even successful sends
    // remain inside our enclosing fixture rollback. Inserts and DB failures are
    // real PostgreSQL queries on the checked-out transaction connection.
    pool.connect = async () => ({
      async query(config, ...args) {
        const text = (typeof config === "string" ? config : config.text).trim().toLowerCase();
        if (text === "begin") {
          assert.equal(transactionActive, false);
          const result = await client.query("SAVEPOINT dm_send_transaction");
          transactionActive = true;
          sendOperations.push("begin");
          return result;
        }
        if (text === "commit") {
          const result = await client.query("RELEASE SAVEPOINT dm_send_transaction");
          transactionActive = false;
          sendOperations.push("commit");
          return result;
        }
        if (text === "rollback") {
          await client.query("ROLLBACK TO SAVEPOINT dm_send_transaction");
          const result = await client.query("RELEASE SAVEPOINT dm_send_transaction");
          transactionActive = false;
          sendOperations.push("rollback");
          return result;
        }
        if (text.startsWith('insert into "direct_messages"')) sendOperations.push("message");
        if (text.startsWith('insert into "notifications"')) sendOperations.push("notification");
        return client.query(config, ...args);
      },
      release() {},
    });
    const { conversationListQuery, parseDmUserId, notifyDmParticipants } = await import("./dmConversations.ts");
    const { default: router, createSendDmHandler } = await import("../routes/dm.ts");
    const sentEvents = [];
    const sendHandler = createSendDmHandler((sender, recipient, event) => {
      assert.equal(transactionActive, false, "realtime must never fire before transaction commit");
      sendOperations.push("event");
      notifyDmParticipants(sender, recipient, event, (userId, value) => sentEvents.push({ userId, value }));
    });
    const { protectApi } = await import("./walletAuth.ts");
    const people = [];
    for (let i = 0; i < 5; i++) {
      const wallet = `0x${randomBytes(20).toString("hex")}`;
      const token = randomBytes(32).toString("hex");
      const hash = `0x${randomBytes(32).toString("hex")}`;
      const { rows: [person] } = await client.query(
        "INSERT INTO users(wallet_address,name,username,registration_tx_hash) VALUES($1,$2,$2,$3) RETURNING id",
        [wallet, `dm_regression_${i}`, hash],
      );
      await client.query("INSERT INTO verified_registrations(user_id,tx_hash) VALUES($1,$2)", [person.id, hash]);
      await client.query("INSERT INTO wallet_sessions(token_hash,wallet_address,expires_at) VALUES($1,$2,now()+interval '1 hour')",
        [createHash("sha256").update(token).digest("hex"), wallet]);
      people.push({ ...person, wallet, token });
    }
    const [me, sentOnly, receivedOnly, stranger, creator] = people;
    async function message(sender, recipient, content, at, read = false) {
      const { rows: [row] } = await client.query(
        "INSERT INTO direct_messages(sender_id,recipient_id,content,created_at,read_at) VALUES($1,$2,$3,$4,$5) RETURNING id",
        [sender.id, recipient.id, content, at, read ? at : null],
      );
      return row;
    }
    await message(me, sentOnly, "SENT_ONLY_OLD", "2020-01-01T00:00:00Z", true);
    await message(receivedOnly, me, "RECEIVED_ONLY_OLD", "2020-01-02T00:00:00Z");
    await message(stranger, sentOnly, "UNRELATED_SECRET", "2020-01-04T00:00:00Z");
    await message(creator, me, "LOCKED_SECRET", "2020-01-03T00:00:00Z");
    await client.query("UPDATE users SET dm_requires_subscription=true,subscription_price=1 WHERE id=$1", [creator.id]);

    async function request(method, path, person = me, body, headers = {}) {
      const route = router.stack.find(layer => layer.route?.path === path && layer.route.methods[method.toLowerCase()]);
      assert.ok(route, `${method} ${path} exists`);
      const req = {
        method, path: path.replace(":userId", String(headers.targetId ?? sentOnly.id)),
        params: { userId: String(headers.targetId ?? sentOnly.id) }, body,
        headers: {
          host: "localhost", origin: "http://localhost",
          ...(person ? { cookie: `mf_session=${person.token}` } : {}),
          ...headers,
        },
        log: { error() {}, info() {}, warn() {} },
      };
      delete req.headers.targetId;
      const res = {
        statusCode: 200, body: undefined,
        status(status) { this.statusCode = status; return this; },
        json(value) { this.body = value; return this; },
      };
      let authorized = false;
      await protectApi(req, res, () => { authorized = true; });
      const handler = method === "POST" && path === "/dm/:userId" ? sendHandler : route.route.stack[0].handle;
      if (authorized) await handler(req, res, error => { if (error) throw error; });
      return res;
    }
    async function inbox(person = me) {
      const result = await request("GET", "/dm/conversations", person);
      assert.equal(result.statusCode, 200);
      assert.ok(Array.isArray(result.body));
      return result.body;
    }
    await t.test("real PostgreSQL reproduces legacy undefined alias 42703; fixed query executes", async () => {
      const compiled = new PgDialect().sqlToQuery(conversationListQuery(me.id));
      const legacy = compiled.sql.replace("ORDER BY r.created_at DESC, r.id DESC", "ORDER BY r.last_at DESC");
      assert.notEqual(legacy, compiled.sql);
      await client.query("SAVEPOINT broken_alias");
      await assert.rejects(client.query(legacy, compiled.params),
        error => error.code === "42703" && error.message.includes("r.last_at"));
      await client.query("ROLLBACK TO SAVEPOINT broken_alias");
      const result = await db.execute(conversationListQuery(me.id));
      assert.equal(result.rows.length, 3);
    });
    await t.test("all old sent/received chats persist on refetch/read/settings; participant-only, sorted", async () => {
      let rows = await inbox();
      assert.deepEqual(rows.map(row => row.userId), [creator.id, receivedOnly.id, sentOnly.id]);
      assert.equal(rows.find(row => row.userId === sentOnly.id).lastMessage.sentByMe, true);
      assert.equal(rows.find(row => row.userId === receivedOnly.id).unreadCount, 1);
      assert.equal(JSON.stringify(rows).includes("UNRELATED_SECRET"), false);
      assert.equal(rows[0].lastMessage.content, "");
      const read = await request("GET", "/dm/:userId", me, undefined, { targetId: receivedOnly.id });
      assert.equal(read.statusCode, 200);
      assert.equal(read.body.messages[0].content, "RECEIVED_ONLY_OLD");
      rows = await inbox();
      assert.equal(rows.length, 3);
      assert.equal(rows.find(row => row.userId === receivedOnly.id).unreadCount, 0);
      assert.deepEqual((await inbox()).map(row => row.userId), rows.map(row => row.userId));
      await client.query("INSERT INTO muted_users(user_id,muted_user_id) VALUES($1,$2)", [me.id, sentOnly.id]);
      rows = await inbox();
      assert.equal(rows.find(row => row.userId === sentOnly.id).isMuted, true);
      assert.equal(rows.length, 3);
    });
    await t.test("deterministic timestamp ties choose highest message id and correct unread count", async () => {
      await message(sentOnly, me, "TIE_FIRST", "2021-01-01T00:00:00Z");
      await message(me, sentOnly, "TIE_LAST", "2021-01-01T00:00:00Z");
      const rows = await inbox();
      assert.equal(rows[0].userId, sentOnly.id);
      assert.equal(rows[0].lastMessage.content, "TIE_LAST");
      assert.equal(rows[0].unreadCount, 0, "mute suppresses unread but never removes chat");
      await client.query("DELETE FROM muted_users WHERE user_id=$1", [me.id]);
      assert.equal((await inbox())[0].unreadCount, 1);
    });
    await t.test("delete hides only caller, is idempotent, preserves both histories and unread state", async () => {
      const { rows: [before] } = await client.query("SELECT count(*)::int AS count FROM direct_messages");
      const removed = await request("DELETE", "/dm/conversations/:userId");
      assert.equal(removed.statusCode, 200);
      assert.deepEqual(removed.body, { deleted: true, userId: sentOnly.id });
      assert.equal((await request("DELETE", "/dm/conversations/:userId")).statusCode, 200);
      assert.equal((await inbox()).some(row => row.userId === sentOnly.id), false);
      assert.equal((await inbox(sentOnly)).some(row => row.userId === me.id), true);
      assert.equal((await request("GET", "/dm/:userId")).body.messages.length, 3);
      assert.equal((await request("GET", "/dm/:userId", sentOnly, undefined, { targetId: me.id })).body.messages.length, 3);
      assert.equal((await inbox()).some(row => row.userId === sentOnly.id), false, "opening history does not restore inbox");
      const { rows: [after] } = await client.query("SELECT count(*)::int AS count FROM direct_messages");
      assert.equal(after.count, before.count);
      assert.equal((await inbox(stranger)).find(row => row.userId === sentOnly.id).lastMessage.content, "UNRELATED_SECRET");
    });
    await t.test("new received/sent messages restore independently; old hidden unread never returns", async () => {
      await message(sentOnly, me, "HIDDEN_UNREAD", "2022-01-01T00:00:00Z");
      assert.equal((await inbox())[0].unreadCount, 1);
      await request("DELETE", "/dm/conversations/:userId");
      // Both participants independently hide their copies.
      await request("DELETE", "/dm/conversations/:userId", sentOnly, undefined, { targetId: me.id });
      assert.equal((await inbox(sentOnly)).some(row => row.userId === me.id), false);
      const sent = await request("POST", "/dm/:userId", sentOnly, { content: "NEW_RECEIVED", senderHidden: true, recipientHidden: true }, { targetId: me.id });
      assert.equal(sent.statusCode, 201);
      assert.equal((await inbox())[0].lastMessage.content, "NEW_RECEIVED");
      assert.equal((await inbox())[0].unreadCount, 1);
      assert.equal((await inbox(sentOnly))[0].lastMessage.content, "NEW_RECEIVED");
      const { rows: [flags] } = await client.query("SELECT sender_hidden,recipient_hidden FROM direct_messages WHERE id=$1", [sent.body.id]);
      assert.deepEqual(flags, { sender_hidden: false, recipient_hidden: false });
      await request("DELETE", "/dm/conversations/:userId");
      const resent = await request("POST", "/dm/:userId", me, { content: "NEW_SENT" });
      assert.equal(resent.statusCode, 201);
      assert.equal((await inbox())[0].lastMessage.content, "NEW_SENT");
      assert.equal((await inbox())[0].unreadCount, 0);
      assert.equal((await request("GET", "/dm/:userId")).body.messages.length, 6);
    });
    await t.test("notification failure rolls back message with no event; successful retry commits before events", async () => {
      await client.query("ALTER TABLE pg_temp.notifications ADD CONSTRAINT dm_notification_failure CHECK (body <> 'ATOMIC_FAILURE')");
      const { rows: [before] } = await client.query(
        "SELECT (SELECT count(*)::int FROM direct_messages) AS messages,(SELECT count(*)::int FROM notifications) AS notifications",
      );
      sendOperations.length = 0;
      sentEvents.length = 0;
      await assert.rejects(request("POST", "/dm/:userId", me, { content: "ATOMIC_FAILURE" }),
        error => error.cause?.code === "23514" && error.cause.message.includes("dm_notification_failure"));
      const { rows: [failed] } = await client.query(
        "SELECT (SELECT count(*)::int FROM direct_messages) AS messages,(SELECT count(*)::int FROM notifications) AS notifications",
      );
      assert.deepEqual(failed, before, "neither insert may persist after notification failure");
      assert.deepEqual(sendOperations, ["begin", "message", "notification", "rollback"]);
      assert.deepEqual(sentEvents, [], "failed sends must not notify either participant");
      await client.query("ALTER TABLE pg_temp.notifications DROP CONSTRAINT dm_notification_failure");
      sendOperations.length = 0;
      const retry = await request("POST", "/dm/:userId", me, { content: "ATOMIC_FAILURE" });
      assert.equal(retry.statusCode, 201);
      assert.equal(retry.body.content, "ATOMIC_FAILURE");
      assert.equal(retry.body.sentByMe, true);
      assert.equal(retry.body.readAt, null);
      assert.equal(typeof retry.body.createdAt, "string");
      const { rows: [success] } = await client.query(
        "SELECT (SELECT count(*)::int FROM direct_messages) AS messages,(SELECT count(*)::int FROM notifications) AS notifications",
      );
      assert.deepEqual(success, { messages: before.messages + 1, notifications: before.notifications + 1 });
      assert.deepEqual(sendOperations, ["begin", "message", "notification", "commit", "event"]);
      assert.deepEqual(sentEvents.map(row => row.userId), [sentOnly.id, me.id]);
      assert.ok(sentEvents.every(row => row.value.messageId === retry.body.id));
      const { rows: [written] } = await client.query("SELECT count(*)::int AS count FROM direct_messages WHERE content='ATOMIC_FAILURE'");
      assert.equal(written.count, 1, "retry creates exactly one message, not a duplicate");
    });
    await t.test("paid/block privacy stays fail-closed, including blocked history entitlement", async () => {
      assert.equal((await request("GET", "/dm/:userId", me, undefined, { targetId: creator.id })).statusCode, 403);
      assert.equal((await request("POST", "/dm/:userId", me, { content: "NO_PAYMENT" }, { targetId: creator.id })).statusCode, 403);
      await client.query("INSERT INTO blocked_users(user_id,blocked_user_id) VALUES($1,$2)", [creator.id, me.id]);
      assert.equal((await request("GET", "/dm/:userId", me, undefined, { targetId: creator.id })).statusCode, 403, "block cannot bypass subscription privacy");
      assert.equal((await inbox()).find(row => row.userId === creator.id).isBlocked, true);
      await client.query("DELETE FROM blocked_users");
      const hash = `0x${randomBytes(32).toString("hex")}`;
      await client.query("INSERT INTO subscriptions(subscriber_id,creator_id,price_per_month,tx_hash,expires_at) VALUES($1,$2,1,$3,now()+interval '1 hour')", [me.id, creator.id, hash]);
      assert.equal((await request("GET", "/dm/:userId", me, undefined, { targetId: creator.id })).statusCode, 403, "unverified subscription never grants access");
      await client.query("INSERT INTO subscription_payments(tx_hash,subscriber_id,creator_id) VALUES($1,$2,$3)", [hash, me.id, creator.id]);
      assert.equal((await request("GET", "/dm/:userId", me, undefined, { targetId: creator.id })).statusCode, 200);
      assert.equal((await inbox()).find(row => row.userId === creator.id).lastMessage.content, "LOCKED_SECRET");
      await client.query("UPDATE subscriptions SET expires_at=now()-interval '1 hour'");
      assert.equal((await request("GET", "/dm/:userId", me, undefined, { targetId: creator.id })).statusCode, 403);
      assert.equal((await inbox()).some(row => row.userId === creator.id), true, "expired subscription does not delete list entry");
      for (const [blocker, blocked] of [[me, sentOnly], [sentOnly, me]]) {
        await client.query("INSERT INTO blocked_users(user_id,blocked_user_id) VALUES($1,$2)", [blocker.id, blocked.id]);
        const denied = await request("POST", "/dm/:userId", me, { content: "BLOCKED" });
        assert.equal(denied.statusCode, 403);
        assert.equal(denied.body.error, "blocked");
        assert.equal((await inbox()).some(row => row.userId === sentOnly.id), true);
        await client.query("DELETE FROM blocked_users");
      }
      // Subscription expiry does not prevent deleting one's own locked entry.
      assert.equal((await request("DELETE", "/dm/conversations/:userId", me, undefined, { targetId: creator.id })).statusCode, 200);
    });
    await t.test("signed identity, CSRF, participant scope and strict ids guard delete/read/send", async () => {
      const { rows: before } = await client.query("SELECT id,sender_hidden,recipient_hidden FROM direct_messages ORDER BY id");
      for (const [method, path, body] of [
        ["GET", "/dm/conversations"], ["GET", "/dm/:userId"],
        ["POST", "/dm/:userId", { content: "FORGED" }], ["DELETE", "/dm/conversations/:userId"],
      ]) {
        assert.equal((await request(method, path, null, body, { "x-wallet-address": me.wallet })).statusCode, 401);
        assert.equal((await request(method, path, stranger, body, { "x-wallet-address": me.wallet })).statusCode, 403);
      }
      assert.equal((await request("DELETE", "/dm/conversations/:userId", me, undefined, { origin: "https://evil.invalid" })).statusCode, 403);
      for (const targetId of ["1junk", "1.5", "0", "-1", "2147483648", String(me.id)]) {
        assert.equal((await request("DELETE", "/dm/conversations/:userId", me, undefined, { targetId })).statusCode, 400);
      }
      assert.equal((await request("DELETE", "/dm/conversations/:userId", me, undefined, { targetId: 2147483647 })).statusCode, 404);
      const { rows: after } = await client.query("SELECT id,sender_hidden,recipient_hidden FROM direct_messages ORDER BY id");
      assert.deepEqual(after, before);
      // A stranger can hide only their own pair with this target, never ours.
      await request("DELETE", "/dm/conversations/:userId", stranger);
      assert.equal((await inbox()).some(row => row.userId === sentOnly.id), true);
      assert.equal((await inbox(stranger)).length, 0);
      await client.query("UPDATE wallet_sessions SET expires_at=now()-interval '1 hour' WHERE wallet_address=$1", [stranger.wallet]);
      assert.equal((await request("DELETE", "/dm/conversations/:userId", stranger)).statusCode, 401);
      await client.query("DELETE FROM verified_registrations WHERE user_id=$1", [sentOnly.id]);
      assert.equal((await request("DELETE", "/dm/conversations/:userId", sentOnly, undefined, { targetId: me.id })).statusCode, 403,
        "signed session without receipt-verified registration cannot delete");
    });
    await t.test("sender and recipient sessions get targeted realtime updates; id parser is strict", () => {
      const event = { type: "new_dm", messageId: 1, senderId: me.id, senderName: null, senderAvatarUrl: null, preview: "test" };
      const events = [];
      notifyDmParticipants(me.id, sentOnly.id, event, (userId, value) => events.push({ userId, value }));
      assert.deepEqual(events, [{ userId: sentOnly.id, value: event }, { userId: me.id, value: event }]);
      for (const invalid of [undefined, ["1"], "1x", "1.0", "1e2", " 1", "0", "-1", "2147483648"]) assert.equal(parseDmUserId(invalid), null);
      assert.equal(parseDmUserId("2147483647"), 2147483647);
    });
  } finally {
    if (appPool && originalQuery) appPool.query = originalQuery;
    if (appPool && originalConnect) appPool.connect = originalConnect;
    await client.query("ROLLBACK");
    const { rows: [cleanup] } = await client.query("SELECT to_regclass('pg_temp.direct_messages') IS NULL AS rolled_back");
    assert.equal(cleanup.rolled_back, true, "fixture tables and their sequences must roll back");
    client.release();
    await admin.end();
    if (appPool) await appPool.end();
  }
});