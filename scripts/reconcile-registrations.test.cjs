const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createRequire } = require("node:module");
const { encodeFunctionData, encodeEventTopics, encodeAbiParameters } = createRequire(require("node:path").resolve(__dirname, "../artifacts/api-server/package.json"))("viem");
const { abi, registries, hashStatus, evidenceStatus, validate } = require("./reconcile-registrations.cjs");
const hash = `0x${"ab".repeat(32)}`;
function fixture() {
  const wallet = `0x${"12".repeat(20)}`;
  const user = { id: 1, wallet_address: wallet, username: "test", registration_tx_hash: hash };
  const tx = { hash, chainId: 143, value: 0n, to: registries[0], from: wallet, blockHash: hash,
    input: encodeFunctionData({ abi, functionName: "registerUser", args: ["test", "INVITE"] }) };
  const receipt = { status: "success", transactionHash: hash, blockHash: hash, from: wallet, to: tx.to,
    logs: [{ address: tx.to, topics: encodeEventTopics({ abi, eventName: "UserRegistered", args: { wallet } }),
      data: encodeAbiParameters([{ type: "string" }, { type: "uint256" }], ["test", 100n]) }] };
  return [user, tx, receipt, { hash, timestamp: 100n }, [true, "test", 100n], [{ code: "INVITE", used_by_id: 1, used_at: new Date() }]];
}
test("missing and malformed hashes fail closed", () => {
  assert.equal(hashStatus(null), "missing_hash");
  assert.equal(hashStatus("0xabc"), "malformed_hash");
  assert.equal(hashStatus(hash), null);
});
test("original consistent chain identity and redeemed admission accepted", () => {
  assert.equal(validate(...fixture()), registries[0]);
});
for (const [name, mutate, reason] of [
  ["wrong registry", f => { f[1].to = `0x${"99".repeat(20)}`; }, "wrong_registry"],
  ["reverted", f => { f[2].status = "reverted"; }, "reverted"],
  ["identity mismatch", f => { f[0].username = "other"; }, "identity_mismatch"],
  ["wrong chain", f => { f[1].chainId = 1; }, "wrong_chain_or_value"],
  ["missing admission", f => { f[5] = []; }, "missing_admission_evidence"],
  ["wrong invite owner", f => { f[5][0].used_by_id = 2; }, "missing_admission_evidence"],
  ["missing event", f => { f[2].logs = []; }, "invalid_registered_event"],
  ["live state mismatch", f => { f[4][0] = false; }, "live_state_mismatch"],
  ["inconsistent block", f => { f[3].hash = "0x00"; }, "inconsistent_receipt"],
]) test(name, () => { const f = fixture(); mutate(f); assert.throws(() => validate(...f), new RegExp(reason)); });
test("replayed hashes and mismatched user evidence rejected; reruns idempotent", () => {
  const [user] = fixture();
  assert.equal(evidenceStatus([], user), null);
  assert.equal(evidenceStatus([{ user_id: 2, tx_hash: hash }], user), "replay_conflict");
  assert.equal(evidenceStatus([{ user_id: 1, tx_hash: `0x${"cd".repeat(32)}` }], user), "replay_conflict");
  assert.equal(evidenceStatus([{ user_id: 1, tx_hash: hash }], user), "already_verified");
});