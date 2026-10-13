import { test } from "node:test";
import assert from "node:assert/strict";
import { BETA_ENDS_AT, isBetaPeriod, PROJECT_SOCIALS } from "./publicSite";

test("beta label ends at the start of October 10 UTC", () => {
  assert.equal(isBetaPeriod(Date.parse("2026-10-06T12:00:00Z")), true);
  assert.equal(isBetaPeriod(BETA_ENDS_AT - 1), true);
  assert.equal(isBetaPeriod(BETA_ENDS_AT), false);
  assert.equal(isBetaPeriod(BETA_ENDS_AT + 1), false);
});

test("official social links use the project handle", () => {
  assert.equal(PROJECT_SOCIALS.x, "https://x.com/MonadFeet");
  assert.equal(PROJECT_SOCIALS.telegram, "https://t.me/MonadFeet");
});
