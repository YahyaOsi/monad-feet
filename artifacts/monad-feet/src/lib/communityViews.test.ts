import test from "node:test";
import assert from "node:assert/strict";
import { uniqueMembers } from "./presenceMembers.ts";
import { loadLeaderboard } from "./leaderboard.ts";

test("online lists count members, not repeated socket records", () => {
  const users = [{ userId: 1 }, { userId: 1 }, { userId: 2 }, { userId: 1 }];
  assert.deepEqual(uniqueMembers(users), [{ userId: 1 }, { userId: 2 }]);
  assert.deepEqual(uniqueMembers([]), []);
});

test("leaderboard reads the shared API array for both tabs and preserves zero scores", async t => {
  const entries = Array.from({ length: 30 }, (_, i) => ({
    userId: i + 1, rank: i + 1, totalPoints: i === 0 ? 0 : 30 - i,
    currentStreak: 0, subscriberCount: 0,
  }));
  const calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string) => {
    calls.push(url);
    return new Response(JSON.stringify(entries));
  });
  for (const period of ["alltime", "weekly"] as const) {
    const result = await loadLeaderboard("/app", period);
    assert.equal(result.length, 25);
    assert.equal(result[0].totalPoints, 0);
  }
  assert.ok(calls[0].includes("period=alltime"));
  assert.ok(calls[1].includes("period=weekly"));
});

test("failed or mismatched leaderboard responses are errors, not empty rankings", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async () => new Response("unavailable", { status: 503 }));
  await assert.rejects(loadLeaderboard("", "alltime"), /Could not load/);
  fetch.mock.mockImplementation(async () => new Response(JSON.stringify({ entries: [] })));
  await assert.rejects(loadLeaderboard("", "weekly"), /Unexpected ranking data/);
});