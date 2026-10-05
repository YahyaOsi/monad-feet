import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  getGetUserQueryKey, getListBadgesQueryKey, getGetCreatorSubscriptionPriceQueryKey,
  getGetCreatorAnalyticsQueryKey, getGetTrendingQueryKey, getGetLeaderboardQueryKey,
} from "@workspace/api-client-react";

test("profile resources and discovery feeds have distinct generated cache keys", () => {
  const keys = [
    getGetUserQueryKey(1), getGetUserQueryKey(2), getListBadgesQueryKey(),
    getGetCreatorSubscriptionPriceQueryKey(1), getGetCreatorSubscriptionPriceQueryKey(2),
    getGetCreatorAnalyticsQueryKey(1), getGetCreatorAnalyticsQueryKey(2),
    getGetTrendingQueryKey(), getGetLeaderboardQueryKey({}),
  ];
  assert.equal(new Set(keys.map(key => JSON.stringify(key))).size, keys.length);
  assert.ok(keys.every(key => key.length > 0));
});

test("frontend must not override queries or invalidations with an empty cache key", () => {
  function inspect(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) inspect(path);
      else if (/\.[jt]sx?$/.test(entry.name)) {
        assert.doesNotMatch(readFileSync(path, "utf8"), /queryKey\s*:\s*\[\s*\]/, path);
      }
    }
  }
  inspect(fileURLToPath(new URL("..", import.meta.url)));
});