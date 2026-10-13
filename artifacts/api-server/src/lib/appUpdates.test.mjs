import { test } from "node:test";
import assert from "node:assert/strict";
import { gameInviteAward, inferGameAction } from "./gameInviteRules.ts";
import { DAILY_BONUS_TASKS, dailyBonusTask } from "./dailyBonusRules.ts";

test("game invites follow each action without changing point multipliers", () => {
  for (let n = 1; n <= 30; n++) {
    assert.equal(gameInviteAward(1, n), 0);
    assert.equal(gameInviteAward(2, n), n % 7 === 0 ? 1 : 0);
    assert.equal(gameInviteAward(3, n), n % 3 === 0 ? 1 : 0);
  }
  for (let n = 0; n < 10; n++) {
    assert.equal(inferGameAction(5 * 2 ** n), 1);
    assert.equal(inferGameAction(7 * 2 ** n), 2);
    assert.equal(inferGameAction(15 * 2 ** n), 3);
  }
  assert.equal(inferGameAction(6), null);
});
test("twelve bonus tasks rotate at UTC midnight and repeat safely", () => {
  const first = new Date("2026-10-06T00:00:00Z");
  const ids = Array.from({ length: 12 }, (_, i) => dailyBonusTask(new Date(+first + i * 86400000)).id);
  assert.equal(new Set(ids).size, 12);
  assert.equal(dailyBonusTask(new Date(+first + 12 * 86400000)).id, ids[0]);
  assert.equal(dailyBonusTask(new Date("2026-10-06T23:59:59Z")).id, "checkin");
  assert.equal(dailyBonusTask(new Date("2026-10-07T00:00:00Z")).id, "post");
  assert.ok(DAILY_BONUS_TASKS.every(t => !/[-_–—]/.test(t.title)));
});
