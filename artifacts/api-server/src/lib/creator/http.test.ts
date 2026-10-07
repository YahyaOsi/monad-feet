import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import app from "../../app";
import { pool } from "@workspace/db";
import { GetProgramResponse } from "./contract";

// These checks intentionally need no database fixture and perform no writes.
// Authenticated native credits still require isolated staging integration tests.
let server: Server;
let base: string;
before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  base = `http://127.0.0.1:${address.port}`;
});
after(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await pool.end();
});
test("the main health route remains available with the main database schema", {
  skip: process.env.RUN_DATABASE_TESTS !== "1",
}, async () => {
  const result = await fetch(`${base}/api/healthz`);
  assert.equal(result.status, 200);
});
test("creator program contract loads without a session and does not cache", async () => {
  const result = await fetch(`${base}/api/creator/program`);
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("cache-control"), "no-store");
  const body = GetProgramResponse.parse(await result.json());
  assert.equal(body.chainId, 143);
  assert.equal(body.poolPercent, 55);
  assert.equal(body.pointsPool, 1_000_000);
});
test("a supplied wallet header never grants creator administrator access", async () => {
  const result = await fetch(`${base}/api/creator/admin`, {
    headers: { "x-wallet-address": "0x1111111111111111111111111111111111111111" },
  });
  assert.equal(result.status, 401);
});
test("a spoofed forwarded host cannot authorize an unrelated browser origin", async () => {
  const result = await fetch(`${base}/api/creator/admin/points`, {
    method: "POST", headers: { Origin: "https://unrelated.example", "x-forwarded-host": "unrelated.example" },
  });
  assert.equal(result.status, 403);
});
test("cross-site mutations are rejected before a session or database write", async () => {
  const result = await fetch(`${base}/api/creator/admin/points`, {
    method: "POST", headers: { "Sec-Fetch-Site": "cross-site" },
  });
  assert.equal(result.status, 403);
});
test("invalid generated-schema input returns a safe form error", async () => {
  const result = await fetch(`${base}/api/creator/auth/challenge`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ wallet: "invalid" }),
  });
  assert.equal(result.status, 400);
  const body = await result.json();
  assert.ok(body && typeof body === "object" && "error" in body && "fields" in body);
  assert.equal(typeof body.error, "string");
  assert.ok(Array.isArray(body.fields));
});
test("unauthenticated final credits are blocked", async () => {
  const result = await fetch(`${base}/api/creator/admin/points`, { method: "POST" });
  assert.equal(result.status, 401);
});
