import { test } from "node:test";
import assert from "node:assert/strict";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@workspace/db/schema";
import { buildNotificationQueries } from "./notificationQueries";

const database = drizzle.mock({ schema });
const prefs = { likesEnabled: true, subscriptionsEnabled: true, badgesEnabled: true, systemEnabled: true };

test("unread count is an unlimited SQL aggregate scoped to the user's actual unread records", () => {
  const queries = buildNotificationQueries(database, 17, prefs);
  const count = queries.unread.toSQL();
  const list = queries.list.toSQL();
  assert.match(count.sql, /count\(\*\)/);
  assert.match(count.sql, /"notifications"\."user_id" = \$1/);
  assert.match(count.sql, /"notifications"\."read" = \$2/);
  assert.doesNotMatch(count.sql, /limit|join/i);
  assert.deepEqual(count.params, [17, false]);
  assert.match(list.sql, /limit \$2/);
  assert.deepEqual(list.params, [17, 50]);
  assert.match(list.sql, /"notifications"\."created_at" desc, "notifications"\."id" desc/);
});

test("preferences filter both the full count and the visible list before pagination", () => {
  for (let mask = 0; mask < 16; mask++) {
    const current = {
      likesEnabled: !!(mask & 1), subscriptionsEnabled: !!(mask & 2),
      badgesEnabled: !!(mask & 4), systemEnabled: !!(mask & 8),
    };
    const disabled = ["like", "subscription", "badge", "system"].filter((_, index) => !(mask & (1 << index)));
    const queries = buildNotificationQueries(database, 23, current);
    const count = queries.unread.toSQL();
    const list = queries.list.toSQL();
    assert.deepEqual(count.params, [23, ...disabled, false]);
    assert.deepEqual(list.params, [23, ...disabled, 50]);
    assert.equal(count.sql.includes("not in"), disabled.length > 0);
    assert.equal(list.sql.includes("not in"), disabled.length > 0);
  }
});