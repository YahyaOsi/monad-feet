// Fixture-only database and WebSocket tests. No chain transactions or RPC calls.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { once } from "node:events";
import { WebSocket } from "ws";
import pg from "../../../../lib/db/node_modules/pg/lib/index.js";

test("live handlers: unique presence, both leaderboard tabs, and points-only X rewards", {
  skip: process.env.RUN_DATABASE_TESTS !== "1" || process.env.NODE_ENV === "production",
}, async () => {
  const originalURL = process.env.DATABASE_URL;
  const admin = new pg.Pool({ connectionString: originalURL });
  const schema = `community_test_${randomBytes(8).toString("hex")}`;
  let server, appPool;
  const sockets = [];
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    const { rows: tables } = await admin.query("SELECT tablename FROM pg_tables WHERE schemaname='public'");
    for (const { tablename: table } of tables) {
      assert.match(table, /^[a-z_][a-z0-9_]*$/);
      await admin.query(`CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`);
    }
    const { rows: serials } = await admin.query(
      "SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=$1 AND column_default LIKE 'nextval%'", [schema]);
    for (const { table_name: table, column_name: column } of serials) {
      assert.match(column, /^[a-z_][a-z0-9_]*$/);
      const seq = `${table}_${column}_fixture_seq`;
      await admin.query(`CREATE SEQUENCE "${schema}"."${seq}"`);
      await admin.query(`ALTER TABLE "${schema}"."${table}" ALTER COLUMN "${column}" SET DEFAULT nextval('"${schema}"."${seq}"')`);
    }
    const url = new URL(originalURL);
    url.searchParams.set("options", `-c search_path=${schema}`);
    process.env.DATABASE_URL = url.toString();
    process.env.LOG_LEVEL = "silent";
    const { pool } = await import("@workspace/db");
    appPool = pool;
    const { default: app } = await import("../app.ts");
    const { setupPresence, getOnlineUsers } = await import("../presence.ts");
    const { COOKIE_NAME } = await import("./walletAuthRules.ts");
    server = app.listen(0, "127.0.0.1");
    setupPresence(server);
    await once(server, "listening");
    const base = `http://127.0.0.1:${server.address().port}`;
    const people = [];
    for (let i = 0; i < 4; i++) {
      const wallet = `0x${randomBytes(20).toString("hex")}`;
      const hash = `0x${randomBytes(32).toString("hex")}`;
      const token = randomBytes(32).toString("hex");
      const { rows: [user] } = await pool.query(
        "INSERT INTO users(wallet_address,username,name,registration_tx_hash) VALUES($1,$2,$2,$3) RETURNING id",
        [wallet, `member_${i}`, hash]);
      await pool.query("INSERT INTO verified_registrations(user_id,tx_hash) VALUES($1,$2)", [user.id, hash]);
      await pool.query("INSERT INTO wallet_sessions(token_hash,wallet_address,expires_at) VALUES($1,$2,now()+interval '1 hour')",
        [createHash("sha256").update(token).digest("hex"), wallet]);
      await pool.query("INSERT INTO streaks(user_id,total_points) VALUES($1,$2)", [user.id, [100, 50, 50, 0][i]]);
      people.push({ ...user, wallet, cookie: `${COOKIE_NAME}=${token}` });
    }
    const [owner, other] = people;
    const headers = { Cookie: owner.cookie, Origin: base, "Content-Type": "application/json" };
    await pool.query("INSERT INTO posts(author_id,content,created_at) VALUES($1,'old',now()-interval '10 days'),($1,'new',now())", [owner.id]);
    await pool.query("INSERT INTO posts(author_id,content,created_at) VALUES($1,'old1',now()-interval '10 days'),($1,'old2',now()-interval '10 days'),($2,'new',now())", [other.id, people[2].id]);
    for (const period of ["alltime", "weekly"]) {
      const response = await fetch(`${base}/api/leaderboard?sortBy=points&period=${period}`);
      assert.equal(response.status, 200);
      const entries = await response.json();
      assert.ok(Array.isArray(entries));
      assert.equal(entries.length, 4);
      assert.equal(entries[0].userId, owner.id);
      assert.equal(entries[0].totalPoints, 100);
      assert.equal(entries[0].postCount, period === "weekly" ? 1 : 2);
      assert.equal(entries[0].subscriptionCount, 0);
      assert.equal(entries[3].totalPoints, 0);
      const personal = await fetch(`${base}/api/leaderboard/me?period=${period}`, {
        headers: { ...headers, Cookie: other.cookie },
      });
      assert.equal((await personal.json()).rank, period === "weekly" ? 3 : 2);
      assert.equal(entries.find(entry => entry.userId === other.id).rank, period === "weekly" ? 3 : 2);
    }
    const personal = await fetch(`${base}/api/leaderboard/me`, { headers });
    assert.equal((await personal.json()).rank, 1);

    // The same signed session opens three tabs, another member opens one.
    async function connect(person) {
      const ws = new WebSocket(`${base.replace("http:", "ws:")}/api/ws`, {
        headers: { Origin: base, Cookie: person.cookie },
      });
      sockets.push(ws);
      await once(ws, "open");
      return ws;
    }
    const first = await connect(owner);
    const second = await connect(owner);
    const third = await connect(owner);
    await connect(other);
    assert.deepEqual(getOnlineUsers().map(user => user.userId).sort(), [owner.id, other.id].sort());
    const snapshot = await fetch(`${base}/api/presence`, { headers });
    const online = await snapshot.json();
    assert.equal(online.count, 2);
    assert.equal(online.users.length, 2);
    first.close(); await once(first, "close");
    assert.equal(getOnlineUsers().length, 2);
    second.close(); await once(second, "close");
    third.close(); await once(third, "close");
    // Let server-side close handlers process the peer's close frame.
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.deepEqual(getOnlineUsers().map(user => user.userId), [other.id]);

    // Previous-day X posting used to award an invite. Keep that history but
    // prove every new task, including consecutive daily posts, awards none.
    await pool.query(
      "INSERT INTO reward_claims(user_id,task,day_key,points,invites) VALUES($1,'post_x',to_char(now() AT TIME ZONE 'UTC'-interval '1 day','YYYY-MM-DD'),10,1)", [owner.id]);
    await pool.query("INSERT INTO invite_codes(code,owner_id) VALUES('KEEPEXISTING',$1)", [owner.id]);
    async function claim(task) {
      const response = await fetch(`${base}/api/rewards/x/${task}`, { method: "POST", headers, body: "{}" });
      assert.equal(response.status, 200);
      return response.json();
    }
    const concurrent = await Promise.all([claim("post_x"), claim("post_x"), claim("post_x")]);
    assert.equal(concurrent.filter(result => result.claimed).length, 1);
    assert.equal(concurrent.reduce((sum, result) => sum + result.points, 0), 10);
    assert.ok(concurrent.every(result => result.invites === 0));
    for (const task of ["follow", "like", "comment", "notifications"]) {
      assert.deepEqual(await claim(task), { claimed: true, points: 5, invites: 0, utcDay: new Date().toISOString().slice(0, 10) });
      assert.equal((await claim(task)).claimed, false);
    }
    const { rows: [balance] } = await pool.query("SELECT total_points FROM streaks WHERE user_id=$1", [owner.id]);
    assert.equal(Number(balance.total_points), 130);
    const { rows: [inviteCount] } = await pool.query("SELECT count(*)::int AS count FROM invite_codes WHERE owner_id=$1", [owner.id]);
    assert.equal(inviteCount.count, 1);
    const status = await fetch(`${base}/api/rewards/x`, { headers });
    assert.equal((await status.json()).postStreakEligible, false);
  } finally {
    await Promise.all(sockets.filter(ws => ws.readyState !== WebSocket.CLOSED).map(ws => new Promise(resolve => {
      ws.once("close", resolve); ws.close();
    })));
    if (server) await new Promise(resolve => server.close(resolve));
    if (appPool) await appPool.end();
    process.env.DATABASE_URL = originalURL;
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  }
});