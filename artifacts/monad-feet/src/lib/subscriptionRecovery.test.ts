import { test } from "node:test";
import assert from "node:assert/strict";
import { recoverOrPaySubscription, type SubscriptionQuote } from "./subscriptionRecovery";

const quote: SubscriptionQuote = { id: "quote", subscriberWallet: "wallet", creatorId: 1,
  creatorWallet: "0x22", price: "2", chainId: 143, contract: "contract", expiresAt: "2030-01-01" };
const hash = `0x${"ab".repeat(32)}`;
function fixture() {
  const map = new Map<string, string>();
  let sends = 0, verifications = 0;
  const options = { key: "wallet:creator", storage: {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value); },
    removeItem: (key: string) => { map.delete(key); },
  }, createQuote: async () => quote, recoverHash: (): string | null => null,
  send: async (_quote: SubscriptionQuote, onHash: (hash: string) => void) => { sends++; onHash(hash); },
  verify: async () => { verifications++; } };
  return { options, map, sends: () => sends, verifications: () => verifications };
}
test("API failure is not success; reload recovery never sends twice", async () => {
  const f = fixture(); const verify = f.options.verify;
  f.options.verify = async () => { throw new Error("503"); };
  await assert.rejects(recoverOrPaySubscription(f.options), /503/);
  assert.ok(f.map.size);
  f.options.verify = verify;
  assert.equal(await recoverOrPaySubscription(f.options), true);
  assert.equal(f.sends(), 1); assert.equal(f.verifications(), 1); assert.equal(f.map.size, 0);
});
test("receipt wait failure retains hash and retries verification only", async () => {
  const f = fixture(); const send = f.options.send;
  f.options.send = async (q, onHash) => { await send(q, onHash); throw new Error("RPC unavailable"); };
  await assert.rejects(recoverOrPaySubscription(f.options), /RPC/);
  assert.equal(await recoverOrPaySubscription(f.options), true);
  assert.equal(f.sends(), 1);
});
test("unknown submission blocks a duplicate, but wallet hash enables recovery", async () => {
  const f = fixture();
  f.map.set(f.options.key, JSON.stringify({ quote, submitting: true }));
  await assert.rejects(recoverOrPaySubscription(f.options), /No second payment/);
  assert.equal(f.sends(), 0);
  f.options.recoverHash = () => hash;
  assert.equal(await recoverOrPaySubscription(f.options), true);
  assert.equal(f.sends(), 0);
});
test("storage unavailable fails before charging; explicit wallet rejection clears intent", async () => {
  const f = fixture();
  f.options.storage.setItem = () => { throw new Error("storage unavailable"); };
  await assert.rejects(recoverOrPaySubscription(f.options), /storage/);
  assert.equal(f.sends(), 0);
  const g = fixture();
  g.options.send = async () => { throw new Error("User rejected the request"); };
  await assert.rejects(recoverOrPaySubscription(g.options), /User rejected/);
  assert.equal(g.map.size, 0);
});