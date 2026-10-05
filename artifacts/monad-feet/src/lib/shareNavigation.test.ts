import { test } from "node:test";
import assert from "node:assert/strict";
import { onboardingPath, postLoginPath, safeShareReturnPath } from "./shareNavigation";

test("only same-site public post and profile paths are accepted as return destinations", () => {
  assert.equal(safeShareReturnPath("/post/123"), "/post/123");
  assert.equal(safeShareReturnPath("/profile/42?preview=true"), "/profile/42");
  assert.equal(safeShareReturnPath("//evil.example/post/1"), null);
  assert.equal(safeShareReturnPath("https://evil.example/post/1"), null);
  assert.equal(safeShareReturnPath("/settings"), null);
  assert.equal(safeShareReturnPath("/post/1/../settings"), null);
});

test("onboarding preserves only a safe shared page and rejects external return URLs", () => {
  assert.equal(onboardingPath("/post/123"), "/onboarding?returnTo=%2Fpost%2F123");
  assert.equal(onboardingPath("https://evil.example"), "/onboarding");
  assert.equal(postLoginPath("?returnTo=%2Fprofile%2F7"), "/profile/7");
  assert.equal(postLoginPath("?returnTo=%2Fsettings"), null);
});