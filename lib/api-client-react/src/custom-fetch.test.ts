import { test } from "node:test";
import assert from "node:assert/strict";
import { customFetch } from "./custom-fetch";

test("guest-readable GETs do not claim a stored, unverified wallet identity", async () => {
  const originalFetch = globalThis.fetch;
  const originalLocalStorage = globalThis.localStorage;
  const seenHeaders: Headers[] = [];
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: () => "0x-unverified-wallet" },
  });
  globalThis.fetch = (async (_input, init) => {
    const headers = new Headers(init?.headers);
    seenHeaders.push(headers);
    // Model the API's public-read policy: no asserted wallet identity is 200,
    // while treating an unverified localStorage address as identity is 403.
    return new Response(headers.get("x-wallet-address") === "" ? "{}" : "forbidden", {
      status: headers.get("x-wallet-address") === "" ? 200 : 403,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  try {
    for (const path of [
      "/api/posts/42",
      "/api/posts?authorId=8",
      "/api/posts/42/comments",
      "/api/users/8",
      "/api/subscriptions/price/8",
    ]) {
      await customFetch(path, { method: "GET", responseType: "json" });
    }
    assert.equal(seenHeaders.length, 5);
    assert.ok(seenHeaders.every((headers) => headers.get("x-wallet-address") === ""));
  } finally {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: originalLocalStorage });
  }
});

test("non-public requests preserve the established wallet identity behavior", async () => {
  const originalFetch = globalThis.fetch;
  const originalLocalStorage = globalThis.localStorage;
  let seenHeader: string | null = null;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: () => "0x-member-wallet" },
  });
  globalThis.fetch = (async (_input, init) => {
    seenHeader = new Headers(init?.headers).get("x-wallet-address");
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    await customFetch("/api/private/posts", { method: "GET", responseType: "json" });
    assert.equal(seenHeader, "0x-member-wallet");
  } finally {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: originalLocalStorage });
  }
});