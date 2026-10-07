import { test } from "node:test";
import assert from "node:assert/strict";
import { launchPolicy, isCreatorAdmin, activityInsideProgram, canFinalizeWeek, canFinalizePoints } from "./policy.ts";
import { apportion } from "./config.ts";

const approved = {
  CREATOR_PROGRAM_ENABLED: "true", CREATOR_RULES_APPROVED: "true",
  CREATOR_PROGRAM_START: "2026-10-05", CREATOR_PROGRAM_END: "2026-10-19",
  CREATOR_REVIEW_GRACE_HOURS: "48",
};
const at = (date: string) => Date.parse(date);

test("missing approval, dates or review deadline keeps live mutation gates closed", () => {
  assert.equal(launchPolicy({}).ready, false);
  for (const key of Object.keys(approved)) {
    const missing: Record<string, string> = { ...approved };
    delete missing[key];
    assert.equal(launchPolicy(missing).ready, false, key);
  }
});
test("invalid calendar dates, non-Monday boundaries and short appeal windows fail closed", () => {
  for (const patch of [
    { CREATOR_PROGRAM_START: "2026-02-31" }, { CREATOR_PROGRAM_START: "2026-10-06" },
    { CREATOR_PROGRAM_END: "2026-10-05" }, { CREATOR_REVIEW_GRACE_HOURS: "0" },
    { CREATOR_REVIEW_GRACE_HOURS: "Infinity" }, { CREATOR_REVIEW_GRACE_HOURS: "24.5" },
  ]) assert.equal(launchPolicy({ ...approved, ...patch }).ready, false);
});
test("admin access is empty by default and exact-wallet only", () => {
  const wallet = "0x1111111111111111111111111111111111111111";
  assert.equal(isCreatorAdmin(wallet, {}), false);
  assert.equal(isCreatorAdmin(null, { CREATOR_ADMIN_WALLETS: wallet }), false);
  assert.equal(isCreatorAdmin(wallet, { CREATOR_ADMIN_WALLETS: ` ${wallet} ` }), true);
  assert.equal(isCreatorAdmin("0x2111111111111111111111111111111111111111", { CREATOR_ADMIN_WALLETS: wallet }), false);
});
test("activities stay inside the approved program and no future day is accepted", () => {
  assert.equal(activityInsideProgram("2026-10-07", at("2026-10-07T12:00:00Z"), approved), true);
  assert.equal(activityInsideProgram("2026-10-04", at("2026-10-07T12:00:00Z"), approved), false);
  assert.equal(activityInsideProgram("2026-10-08", at("2026-10-07T12:00:00Z"), approved), false);
  assert.equal(activityInsideProgram("2026-10-19", at("2026-10-19T00:00:00Z"), approved), false);
});
test("week finalization waits for its full review and appeal window", () => {
  assert.equal(canFinalizeWeek("2026-10-05", at("2026-10-14T00:00:00Z"), approved), true);
  assert.equal(canFinalizeWeek("2026-10-05", at("2026-10-13T23:59:59Z"), approved), false);
  assert.equal(canFinalizeWeek("2026-09-28", at("2026-10-14T00:00:00Z"), approved), false);
  assert.equal(canFinalizeWeek("2026-10-19", at("2026-10-28T00:00:00Z"), approved), false);
});
test("final app points wait until the program and last review window end", () => {
  assert.equal(canFinalizePoints(at("2026-10-21T00:00:00Z"), approved), true);
  assert.equal(canFinalizePoints(at("2026-10-20T23:59:59Z"), approved), false);
});
test("integer MON and points allocations preserve the complete pool", () => {
  for (const pool of [0n, 1n, 550n * 10n ** 18n, 1_000_000n]) {
    const parts = apportion(pool, [{ id: 9, score: 100 }, { id: 2, score: 100 }, { id: 3, score: 80 }]);
    assert.equal(parts.reduce((sum, part) => sum + part.amount, 0n), pool);
  }
  assert.deepEqual(apportion(10n, []), []);
  assert.deepEqual(apportion(10n, [{ id: 1, score: 0 }]), []);
  assert.deepEqual(apportion(1n, [{ id: 9, score: 1 }, { id: 2, score: 1 }]), [{ id: 9, amount: 0n }, { id: 2, amount: 1n }]);
});
