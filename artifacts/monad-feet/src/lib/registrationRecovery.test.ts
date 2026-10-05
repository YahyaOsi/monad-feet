import { test } from "node:test";
import assert from "node:assert/strict";
import { recoverRegistration, registrationError, registrationKey } from "./registrationRecovery";

const hash = `0x${"ab".repeat(32)}`;
function fixture() {
  let sends = 0;
  let saved: string | null = null;
  const options = {
    prepare: async () => ({ registered: false, txHash: null as string | null }),
    savedHash: null as string | null,
    receipt: async () => "success" as "success" | "reverted",
    save: (value: string | null) => { saved = value; },
    send: async (onSubmitted: (value: string) => void) => { sends++; onSubmitted(hash); return hash; },
    assertCurrent: () => {},
  };
  return { options, sends: () => sends, saved: () => saved };
}
test("taken username preflight never prompts wallet", async () => {
  const f = fixture();
  f.options.prepare = async () => { throw { data: { code: "USERNAME_TAKEN" } }; };
  await assert.rejects(recoverRegistration(f.options));
  assert.equal(f.sends(), 0);
});
test("historic chain registration is reused for a new app handle", async () => {
  const f = fixture();
  f.options.prepare = async () => ({ registered: true, txHash: hash });
  assert.equal(await recoverRegistration(f.options), hash);
  assert.equal(f.sends(), 0);
});
test("unknown receipt keeps saved hash and never sends", async () => {
  const f = fixture();
  f.options.savedHash = hash; f.options.save(hash);
  f.options.receipt = async () => { throw new Error("RPC timeout"); };
  await assert.rejects(recoverRegistration(f.options));
  assert.equal(f.saved(), hash); assert.equal(f.sends(), 0);
});
test("proven revert clears proof without a second write in the same attempt", async () => {
  const f = fixture();
  f.options.savedHash = hash; f.options.save(hash);
  f.options.receipt = async () => "reverted";
  await assert.rejects(recoverRegistration(f.options), /reverted/);
  assert.equal(f.saved(), null); assert.equal(f.sends(), 0);
});
test("registration race discovers proof without signing again", async () => {
  const f = fixture(); let prepares = 0;
  f.options.prepare = async () => (++prepares === 1
    ? { registered: false, txHash: null } : { registered: true, txHash: hash });
  f.options.send = async () => { throw new Error("already registered"); };
  assert.equal(await recoverRegistration(f.options), hash);
  assert.equal(prepares, 2);
});
test("wallet changes prevent writes", async () => {
  const f = fixture();
  f.options.assertCurrent = () => { throw new Error("Wallet changed"); };
  await assert.rejects(recoverRegistration(f.options), /Wallet changed/);
  assert.equal(f.sends(), 0);
});
test("receipt wait failure after submission retains proof for retry", async () => {
  const f = fixture();
  f.options.send = async (onSubmitted) => {
    onSubmitted(hash);
    throw new Error("RPC timeout");
  };
  await assert.rejects(recoverRegistration(f.options), /RPC timeout/);
  assert.equal(f.saved(), hash);
  f.options.savedHash = f.saved();
  assert.equal(await recoverRegistration(f.options), hash);
});
test("recovery keys isolate wallets and contracts; wallet errors omit traces", () => {
  assert.notEqual(registrationKey("a", "c", 143), registrationKey("b", "c", 143));
  assert.notEqual(registrationKey("a", "c", 143), registrationKey("a", "d", 143));
  assert.equal(registrationKey("A", "C", 143), registrationKey("a", "c", 143));
  assert.equal(registrationError(new Error("User rejected request. viem trace...")), "Wallet request cancelled. You can try again.");
});