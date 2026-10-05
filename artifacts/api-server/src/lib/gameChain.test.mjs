import { test } from "node:test";
import { strict as assert } from "node:assert";
import { encodeFunctionData, encodeEventTopics, encodeAbiParameters, parseAbiParameters, parseEther } from "viem";
import { gameAbi, validateRewardReceipt, gameActionState, InvalidReceiptError } from "./gameChain.ts";
import { REGISTRY } from "./chainConfig.ts";

const wallet = "0x1111111111111111111111111111111111111111";
const hash = `0x${"ab".repeat(32)}`;
const blockHash = `0x${"cd".repeat(32)}`;
const timestamp = 1790726400n;
function fixture(action = 1, points = 5n, invite = false) {
  const tx = {
    chainId: 143, from: wallet, to: REGISTRY, value: parseEther(["1.43", "14.3", "143"][action - 1]),
    input: encodeFunctionData({ abi: gameAbi, functionName: "playFeetGame", args: [action] }), hash, blockHash,
  };
  const logs = [{
    address: REGISTRY,
    topics: encodeEventTopics({ abi: gameAbi, eventName: "GamePlayed", args: { user: wallet } }),
    data: encodeAbiParameters(parseAbiParameters("uint8, uint256, uint256"), [action, points, timestamp]),
  }];
  if (invite) logs.push({
    address: REGISTRY,
    topics: encodeEventTopics({ abi: gameAbi, eventName: "InviteEarned", args: { user: wallet } }),
    data: encodeAbiParameters(parseAbiParameters("uint256"), [timestamp]),
  });
  return { tx, receipt: { status: "success", from: wallet, to: REGISTRY, logs, transactionHash: hash, blockHash } };
}
test("all 30 valid game point awards and fees verify", () => {
  for (let action = 1; action <= 3; action++) for (let count = 0; count < 10; count++) {
    const points = BigInt([5, 7, 15][action - 1] * 2 ** count);
    const { tx, receipt } = fixture(action, points);
    assert.equal(validateRewardReceipt("game", wallet, tx, receipt, timestamp).points, Number(points));
  }
});
test("one matching invite event grants exactly one invite", () => {
  const { tx, receipt } = fixture(1, 80n, true);
  assert.equal(validateRewardReceipt("game", wallet, tx, receipt, timestamp).invites, 1);
});
test("reject wrong sender, chain, destination, value, revert and mismatched block", () => {
  const { tx, receipt } = fixture();
  for (const patch of [
    { from: REGISTRY }, { chainId: 1 }, { to: wallet }, { value: 0n }, { blockHash: hash },
  ]) assert.throws(() => validateRewardReceipt("game", wallet, { ...tx, ...patch }, receipt, timestamp), InvalidReceiptError);
  assert.throws(() => validateRewardReceipt("game", wallet, tx, { ...receipt, status: "reverted" }, timestamp), InvalidReceiptError);
});
test("reject invalid points, event timestamp, duplicate game/invite events", () => {
  const invalid = fixture(1, 6n);
  assert.throws(() => validateRewardReceipt("game", wallet, invalid.tx, invalid.receipt, timestamp), InvalidReceiptError);
  const { tx, receipt } = fixture(1, 5n, true);
  assert.throws(() => validateRewardReceipt("game", wallet, tx, receipt, timestamp + 1n), InvalidReceiptError);
  for (const index of [0, 1]) assert.throws(() =>
    validateRewardReceipt("game", wallet, tx, { ...receipt, logs: [...receipt.logs, receipt.logs[index]] }, timestamp), InvalidReceiptError);
});
test("UTC rollover resets EACH action, daily cap is ten, lifetime total retained", () => {
  const day = timestamp / 86400n;
  assert.deepEqual(gameActionState(day, [day, 10, 3, 0, 13n]).map(a => [a.remaining, a.nextPoints]), [[0, 0], [7, 56], [10, 15]]);
  assert.deepEqual(gameActionState(day + 1n, [day, 10, 3, 0, 13n]).map(a => [a.count, a.nextPoints]), [[0, 5], [0, 7], [0, 15]]);
});
test("check-in must be matching nonpayable calldata and one timestamped event", () => {
  const { tx, receipt } = fixture();
  tx.value = 0n;
  tx.input = encodeFunctionData({ abi: gameAbi, functionName: "dailyCheckin" });
  receipt.logs = [{
    address: REGISTRY,
    topics: encodeEventTopics({ abi: gameAbi, eventName: "StreakCheckin", args: { user: wallet } }),
    data: encodeAbiParameters(parseAbiParameters("uint256, uint256, uint256"), [7n, 40n, timestamp]),
  }];
  assert.equal(validateRewardReceipt("checkin", wallet, tx, receipt, timestamp).streak, 7);
  assert.throws(() => validateRewardReceipt("game", wallet, tx, receipt, timestamp), InvalidReceiptError);
});