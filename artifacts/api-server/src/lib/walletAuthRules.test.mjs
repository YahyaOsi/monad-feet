import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  addressValid, challengeMessage, challengeUsable, expectedOrigin, readCookie, identityMismatch,
} from "./walletAuthRules.ts";

const address = "0x0000000000000000000000000000000000000001";
const origin = "https://monad.example";
const message = challengeMessage(address, origin, "random-once", new Date(0), new Date(300000));

test("auth rejects missing or foreign origins and invalid wallets", () => {
  assert.equal(expectedOrigin({ headers: { host: "monad.example" } }), null);
  assert.equal(expectedOrigin({ headers: { host: "monad.example", origin: "https://attacker.example" } }), null);
  assert.equal(expectedOrigin({ headers: { host: "localhost:8080", origin: "http://localhost:8080" } }), "http://localhost:8080");
  assert.equal(addressValid("not-a-wallet"), false);
  assert.equal(readCookie("mf_session=forged"), null);
  assert.equal(identityMismatch("0x0000000000000000000000000000000000000002", address), true);
  assert.equal(identityMismatch(address.toUpperCase(), address), false);
});

test("challenge is bound to address, origin and message and cannot be replayed", () => {
  const row = { walletAddress: address, origin, message, consumedAt: null, expiresAt: new Date(300000) };
  assert.equal(challengeUsable(row, address, origin, message, new Date(1)), true);
  assert.equal(challengeUsable(row, address, "https://attacker.example", message, new Date(1)), false);
  assert.equal(challengeUsable(row, "0x0000000000000000000000000000000000000002", origin, message, new Date(1)), false);
  assert.equal(challengeUsable(row, address, origin, "forged", new Date(1)), false);
  assert.equal(challengeUsable({ ...row, consumedAt: new Date(2) }, address, origin, message, new Date(3)), false);
  assert.equal(challengeUsable(row, address, origin, message, new Date(300001)), false);
  assert.match(message, /Chain ID: 143/);
});