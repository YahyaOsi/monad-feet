import { test } from "node:test";
import assert from "node:assert/strict";
import { spaRewardSchedule, spaAppPoints } from "./spaPointRules.ts";

test("wash, massage and pedicure have four, seven and ten doubling steps", () => {
  const expected = [
    [5, 10, 10, 20, 20, 20, 40, 40, 40, 80],
    [7, 14, 28, 56, 56, 112, 224, 224, 448, 896],
    [30, 60, 120, 240, 480, 960, 1920, 3840, 7680, 15360],
  ];
  assert.deepEqual([1, 2, 3].map(id => spaRewardSchedule(id).dailyRewards), expected);
  assert.deepEqual([1, 2, 3].map(id => spaRewardSchedule(id).doublingPurchases.length), [4, 7, 10]);
  assert.deepEqual(expected.map(rewards => rewards.reduce((s, p) => s + p, 0)), [285, 2065, 30690]);
  for (const [id, base] of [[1, 5], [2, 7], [3, 15]]) {
    const schedule = spaRewardSchedule(id);
    let previous = base;
    schedule.dailyRewards.forEach((points, i) => {
      assert.equal(points, previous * (schedule.doublingPurchases.includes(i + 1) ? 2 : 1));
      previous = points;
    });
  }
  for (let i = 0; i < 10; i++) {
    assert.ok(expected[0][i] < expected[1][i] && expected[1][i] < expected[2][i]);
    for (const [id, base] of [[1, 5], [2, 7], [3, 15]]) {
      assert.equal(spaAppPoints(id, base * 2 ** i), expected[id - 1][i]);
    }
  }
  assert.equal(expected[0].slice(0, 6).reduce((s, p) => s + p, 0), 85);
  assert.equal(expected[0].slice(3, 9).reduce((s, p) => s + p, 0), 180);
});
test("invalid chain rewards cannot select an app award", () => {
  for (const p of [0, -5, 6, 3.5, 5120, NaN, Infinity]) assert.throws(() => spaAppPoints(1, p));
  assert.throws(() => spaAppPoints(4, 5));
});
