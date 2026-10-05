import { test } from "node:test";
import { strict as assert } from "node:assert";
import { dailyCheckinPoints, referralPoints, utcDay, previousUtcDay, xTaskReward, claimable } from "./reward-rules.ts";

test("daily baseline is 10 regardless of streak or NFT status", () => {
  assert.deepEqual([1, 2, 5, 7].map((day) => dailyCheckinPoints(day, false)), [10, 10, 10, 10]);
  assert.equal(dailyCheckinPoints(7, true), 10);
});

test("unique referral registration awards increase by ten then cap at fifty", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 20].map(referralPoints), [10, 20, 30, 40, 50, 50, 50]);
});

test("UTC midnight boundary and X tasks give points only", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");
  assert.equal(utcDay(now), "2026-01-01");
  assert.equal(previousUtcDay(now), "2025-12-31");
  assert.deepEqual(xTaskReward("post_x"), { points: 10, invites: 0 });
  for (const task of ["follow", "like", "comment", "notifications"]) {
    assert.deepEqual(xTaskReward(task), { points: 5, invites: 0 });
  }
});

test("repeat daily and lifetime claims are ineligible; next UTC day is eligible", () => {
  assert.equal(claimable(null, "once"), true);
  assert.equal(claimable("once", "once"), false);
  assert.equal(claimable("2026-01-01", "2026-01-01"), false);
  assert.equal(claimable("2026-01-01", "2026-01-02"), true);
});