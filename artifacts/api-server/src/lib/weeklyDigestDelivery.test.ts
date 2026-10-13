import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@workspace/db/schema";
import { pool as appPool } from "@workspace/db";
import { deliverWeeklyDigest, digestWeekStart } from "./weeklyDigestDelivery";
const require = createRequire(new URL("../../../../lib/db/package.json", import.meta.url));
const pg = require("pg");

test("week boundaries are Sunday UTC, including year boundaries", () => {
  assert.equal(digestWeekStart(new Date("2026-10-17T23:59:59Z")).toISOString(), "2026-10-11T00:00:00.000Z");
  assert.equal(digestWeekStart(new Date("2027-01-01T00:00:00Z")).toISOString(), "2026-12-27T00:00:00.000Z");
});

test("weekly delivery survives concurrent instances, restarts, old titles and read state", {
  skip: process.env.RUN_DATABASE_TESTS !== "1" || process.env.NODE_ENV === "production",
}, async () => {
  const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const name = `digest_test_${randomBytes(8).toString("hex")}`;
  let first: InstanceType<typeof pg.Pool> | undefined, second: InstanceType<typeof pg.Pool> | undefined;
  try {
    await admin.query(`CREATE SCHEMA "${name}"`);
    await admin.query(`CREATE TABLE "${name}".notifications (
      id serial PRIMARY KEY, user_id integer NOT NULL, type text NOT NULL,
      title text NOT NULL, body text NOT NULL, actor_id integer, resource_id integer,
      resource_type text, read boolean DEFAULT false, created_at timestamp NOT NULL DEFAULT now()
    )`);
    const config = { connectionString: process.env.DATABASE_URL, options: `-c search_path=${name}`, max: 5 };
    first = new pg.Pool(config); second = new pg.Pool(config);
    const a = drizzle(first, { schema }), b = drizzle(second, { schema });
    const now = new Date("2026-10-11T13:00:00Z");
    const send = (user: number, database = a, date = now) =>
      deliverWeeklyDigest(user, "Your week: Oct 11", "DIGEST:{}", date, database);
    const simultaneous = await Promise.all(Array.from({ length: 20 }, (_, i) => send(1, i % 2 ? a : b)));
    assert.equal(simultaneous.filter(Boolean).length, 1);
    assert.equal(await send(1, b), false);
    await first.query("UPDATE notifications SET read=true");
    assert.equal(await send(1), false);
    await first.query("INSERT INTO notifications(user_id,type,title,body,created_at) VALUES(2,'system','Old Weekly Digest','DIGEST:{}',$1)", [now]);
    assert.equal(await send(2), false);
    assert.equal(await send(3), true, "a missing recipient can recover after a partial run");
    assert.equal(await send(1, b, new Date("2026-10-18T00:00:00Z")), true);
    assert.equal(await send(1, a, new Date("2026-10-18T12:00:00Z")), false);
    const count = await first.query("SELECT count(*)::int AS n FROM notifications WHERE user_id=1");
    assert.equal(count.rows[0].n, 2);
  } finally {
    await first?.end(); await second?.end(); await appPool.end();
    await admin.query(`DROP SCHEMA "${name}" CASCADE`);
    await admin.end();
  }
});
