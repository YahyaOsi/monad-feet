import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeFunctionData, encodeEventTopics, encodeAbiParameters, parseAbiParameters } from "viem";
import { registrationAbi, verifyRegistration, discoverRegistration, normalizeRegistrationUsername, isUniqueViolation } from "./registrationChain.ts";
import { REGISTRY } from "./chainConfig.ts";

const wallet = `0x${"11".repeat(20)}`, hash = `0x${"aa".repeat(32)}`, blockHash = `0x${"bb".repeat(32)}`;
function fixture() {
  const original = "original_chain_handle", timestamp = 500n;
  const state = [true, original, timestamp];
  const tx = { hash, blockHash, blockNumber: 50n, chainId: 143, from: wallet, to: REGISTRY, value: 0n,
    input: encodeFunctionData({ abi: registrationAbi, functionName: "registerUser", args: [original, "HISTORICAL_UNUSED_BY_CONTRACT"] }) };
  const receipt = { transactionHash: hash, blockHash, blockNumber: 50n, status: "success", from: wallet, to: REGISTRY,
    logs: [{ address: REGISTRY,
      topics: encodeEventTopics({ abi: registrationAbi, eventName: "UserRegistered", args: { wallet } }),
      data: encodeAbiParameters(parseAbiParameters("string, uint256"), [original, timestamp]) }] };
  let scans = 0, blocks = 0;
  const rpc = {
    getChainId: async () => 143, getTransactionReceipt: async () => receipt, getTransaction: async () => tx,
    readContract: async () => state, getBlockNumber: async () => 100n,
    getBlock: async ({ blockNumber }) => { blocks++; return { hash: blockHash, timestamp: blockNumber * 10n }; },
    getLogs: async request => {
      scans++;
      assert.equal(request.address, REGISTRY);
      assert.equal(request.args.wallet, wallet);
      assert.equal(request.fromBlock, 50n);
      assert.equal(request.toBlock, 50n);
      return [{ transactionHash: hash, removed: false, args: { wallet, username: original, timestamp } }];
    },
  };
  return { rpc, tx, receipt, state, counts: () => ({ scans, blocks }) };
}
test("original receipt is independent of new app handle and historical invite", async () => {
  const f = fixture();
  assert.equal(await verifyRegistration(hash, wallet, f.rpc), true);
  assert.equal(normalizeRegistrationUsername(" New_Handle "), "new_handle");
});
test("registered wallet with no saved hash recovers original receipt with bounded indexed logs", async () => {
  const f = fixture();
  assert.deepEqual(await discoverRegistration(wallet, f.rpc), { registered: true, txHash: hash });
  assert.equal(f.counts().scans, 1);
  assert.ok(f.counts().blocks < 20);
});
test("RPC and log failures never return unregistered", async () => {
  for (const method of ["getChainId", "readContract", "getBlock", "getLogs", "getTransactionReceipt"]) {
    const f = fixture();
    f.rpc[method] = async () => { throw new Error("offline"); };
    await assert.rejects(discoverRegistration(wallet, f.rpc), /offline/);
  }
  const f = fixture();
  f.rpc.getLogs = async () => [];
  await assert.rejects(discoverRegistration(wallet, f.rpc), /uniquely/);
  f.state[0] = false;
  assert.deepEqual(await discoverRegistration(wallet, f.rpc), { registered: false, txHash: null });
});
test("reject forged hash, wrong wallet, reverted receipt, wrong chain, registry, calldata, event and state", async () => {
  assert.equal(await verifyRegistration("forged", wallet, fixture().rpc), false);
  assert.equal(await verifyRegistration(hash, `0x${"22".repeat(20)}`, fixture().rpc), false);
  for (const mutate of [
    f => f.tx.chainId = 1,
    f => f.tx.hash = `0x${"cc".repeat(32)}`,
    f => f.tx.blockHash = `0x${"cc".repeat(32)}`,
    f => f.receipt.status = "reverted",
    f => f.receipt.to = wallet,
    f => f.tx.value = 1n,
    f => f.tx.input = "0x12345678",
    f => f.receipt.logs[0].data = encodeAbiParameters(parseAbiParameters("string, uint256"), ["forged", 500n]),
    f => f.state[0] = false,
    f => f.state[1] = "different",
    f => f.state[2] = 501n,
  ]) {
    const f = fixture(); mutate(f);
    assert.equal(await verifyRegistration(hash, wallet, f.rpc), false);
  }
});
test("normalization and nested Drizzle unique errors", () => {
  for (const value of ["ab", "bad space", "bad-name", "x".repeat(33), null]) assert.equal(normalizeRegistrationUsername(value), null);
  assert.equal(isUniqueViolation({ cause: { cause: { code: "23505" } } }), true);
  assert.equal(isUniqueViolation(new Error("unrelated")), false);
});

// Minimized public RPC format from the affected registration at block 109408114.
// Outer relay calldata is opaque to this verifier; unrelated caveat/signature
// frames are omitted. Actual inner calldata, identities and receipt are retained.
function delegatedFixture() {
  const f = fixture();
  const account = "0xf2c75e2aa9ed9eaab089665e61e291683e98e524";
  const relayer = "0xb01caea8c6c47bbf4f4b4c5080ca642043359c2e";
  const manager = "0xdb9b1e94b5b69df7e401ddbede43491141047db3";
  const registrationHash = "0x8d251589b6edcc87c7fc18f363907ebd9bf69cf9e571c71b31d1c7dd882ff4e1";
  const canonicalBlock = "0x2a3d1520f3c97e3221679597856b8e41cafb4adaa2348275fe31cf69fc02fed0";
  f.state.splice(0, 3, true, "monadpriest", 1790797315n);
  Object.assign(f.tx, { hash: registrationHash, from: relayer, to: manager, input: "0xcef6d209",
    blockHash: canonicalBlock, blockNumber: 109408114n, type: "eip1559" });
  Object.assign(f.receipt, { transactionHash: registrationHash, from: relayer, to: manager,
    blockHash: canonicalBlock, blockNumber: 109408114n, type: "eip1559" });
  f.receipt.logs = [{ address: REGISTRY,
    topics: encodeEventTopics({ abi: registrationAbi, eventName: "UserRegistered", args: { wallet: account } }),
    data: encodeAbiParameters(parseAbiParameters("string, uint256"), ["monadpriest", 1790797315n]) }];
  f.rpc.getBlock = async () => ({ hash: canonicalBlock, timestamp: 1790797315n });
  const inner = { type: "CALL", from: account, to: REGISTRY.toLowerCase(), value: "0x0",
    input: encodeFunctionData({ abi: registrationAbi, functionName: "registerUser",
      args: ["monadpriest", "768977AFACA949FA905124981D6ECC07"] }) };
  const accountFrame = { type: "CALL", from: manager, to: account, value: "0x0", input: "0xd691c964", calls: [inner] };
  const trace = { type: "CALL", from: relayer, to: manager, value: "0x0", input: f.tx.input, calls: [accountFrame] };
  f.rpc.request = async ({ method, params }) => {
    assert.equal(method, "debug_traceTransaction");
    assert.deepEqual(params, [registrationHash, { tracer: "callTracer" }]);
    return trace;
  };
  return { ...f, account, registrationHash, trace, inner, accountFrame };
}
test("actual Monad delegated-wallet format proves inner EVM sender instead of outer relayer", async () => {
  const f = delegatedFixture();
  assert.notEqual(f.tx.from, f.account);
  assert.equal(await verifyRegistration(f.registrationHash, f.account, f.rpc), true);
});
test("delegated recovery rejects spoofed/failed traces and does not infer calls from events", async () => {
  for (const mutate of [
    f => f.inner.from = wallet,
    f => f.inner.to = wallet,
    f => f.inner.type = "DELEGATECALL",
    f => f.inner.value = "0x1",
    f => f.inner.input = "0x12345678",
    f => f.inner.error = "execution reverted",
    f => f.accountFrame.error = "execution reverted",
    f => f.trace.error = "execution reverted",
    f => f.trace.from = wallet,
    f => f.trace.to = wallet,
    f => f.trace.input = "0x12345678",
    f => f.trace.value = "0x1",
    f => f.trace.calls = [],
    f => f.accountFrame.calls.push({ ...f.inner }),
  ]) {
    const f = delegatedFixture(); mutate(f);
    assert.equal(await verifyRegistration(f.registrationHash, f.account, f.rpc), false);
  }
  const f = delegatedFixture();
  f.rpc.request = async () => { throw new Error("Trace method unavailable"); };
  await assert.rejects(verifyRegistration(f.registrationHash, f.account, f.rpc), /Trace method unavailable/);
});