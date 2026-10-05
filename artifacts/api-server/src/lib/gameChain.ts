import { createPublicClient, decodeEventLog, decodeFunctionData, http, keccak256, parseAbi, parseEther, type Transaction, type TransactionReceipt } from "viem";
import { CHAIN_ID, REGISTRY, TREASURY, REGISTRY_RUNTIME_HASH } from "./chainConfig";

export const GAME_ACTIONS = [
  { id: 1, name: "Wash Feet", priceMon: "1.43", basePoints: 5 },
  { id: 2, name: "Massage Feet", priceMon: "14.3", basePoints: 7 },
  { id: 3, name: "Pedicure", priceMon: "143", basePoints: 15 },
] as const;
export const gameAbi = parseAbi([
  "function playFeetGame(uint8 actionType) payable",
  "function dailyCheckin()",
  "function feeRecipient() view returns (address)",
  "function gameStates(address) view returns (uint256 lastPlayDay, uint8 washCount, uint8 massageCount, uint8 pedicureCount, uint256 totalPurchases)",
  "function users(address) view returns (bool registered, string username, uint256 registeredAt, uint256 postCount, uint256 likesSent, uint256 streakPoints, uint256 currentStreak, uint256 longestStreak, uint256 lastCheckin, string name, string bio, string avatarUri)",
  "event GamePlayed(address indexed user, uint8 actionType, uint256 pointsEarned, uint256 timestamp)",
  "event InviteEarned(address indexed user, uint256 timestamp)",
  "event StreakCheckin(address indexed user, uint256 currentStreak, uint256 totalPoints, uint256 timestamp)",
]);
export const gameRpc = createPublicClient({ transport: http("https://rpc.monad.xyz") });
export class InvalidReceiptError extends Error {}
function requireReceipt(condition: unknown, message: string): asserts condition {
  if (!condition) throw new InvalidReceiptError(message);
}
export function safeNumber(value: bigint): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("On-chain number exceeds safe API range");
  return Number(value);
}
export function gameActionState(day: bigint, state: readonly [bigint, number, number, number, bigint]) {
  return GAME_ACTIONS.map((a, i) => {
    const count = state[0] === day ? Number(state[i + 1]) : 0;
    if (count < 0 || count > 10) throw new Error("Invalid on-chain game count");
    return { ...a, count, remaining: 10 - count, nextPoints: count < 10 ? a.basePoints * 2 ** count : 0 };
  });
}
export async function checkGameDeployment() {
  if (await gameRpc.getChainId() !== CHAIN_ID) throw new Error("Wrong Monad RPC chain");
  const [code, treasury] = await Promise.all([
    gameRpc.getCode({ address: REGISTRY }),
    gameRpc.readContract({ address: REGISTRY, abi: gameAbi, functionName: "feeRecipient" }),
  ]);
  if (!code || code === "0x" || keccak256(code) !== REGISTRY_RUNTIME_HASH ||
    treasury.toLowerCase() !== TREASURY) throw new Error("Monad runtime or treasury mismatch");
}

/** Pure receipt checks, kept separate from RPC for adversarial tests. */
export function validateRewardReceipt(
  kind: "game" | "checkin", wallet: string, tx: Pick<Transaction, "chainId" | "from" | "to" | "value" | "input" | "hash" | "blockHash">,
  receipt: Pick<TransactionReceipt, "status" | "from" | "to" | "logs" | "transactionHash" | "blockHash">, timestamp: bigint,
) {
  wallet = wallet.toLowerCase();
  requireReceipt(receipt.status === "success" && receipt.from.toLowerCase() === wallet &&
    receipt.to?.toLowerCase() === REGISTRY.toLowerCase() &&
    tx.chainId === CHAIN_ID && tx.from.toLowerCase() === wallet &&
    tx.to?.toLowerCase() === REGISTRY.toLowerCase() &&
    tx.hash.toLowerCase() === receipt.transactionHash.toLowerCase() && tx.blockHash === receipt.blockHash,
  "Transaction is not a successful matching Monad registry call");
  let call;
  try { call = decodeFunctionData({ abi: gameAbi, data: tx.input }); }
  catch { throw new InvalidReceiptError("Unrecognized registry calldata"); }
  const events = receipt.logs.filter((l) => l.address.toLowerCase() === REGISTRY.toLowerCase()).flatMap((l) => {
    try { return [decodeEventLog({ abi: gameAbi, data: l.data, topics: l.topics, strict: true })]; }
    catch { return []; }
  });
  if (kind === "game") {
    requireReceipt(call.functionName === "playFeetGame", "Not a game purchase");
    const action = GAME_ACTIONS.find((a) => a.id === call.args[0]);
    requireReceipt(action && tx.value === parseEther(action.priceMon), "Incorrect action or MON fee");
    // Ambiguous/reentrant reward receipts must be reviewed, never guessed.
    const games = events.filter((e) => e.eventName === "GamePlayed");
    const invites = events.filter((e) => e.eventName === "InviteEarned");
    requireReceipt(games.length === 1 && invites.length <= 1, "Ambiguous game receipt");
    const event = games[0];
    requireReceipt(event.args.user.toLowerCase() === wallet && event.args.actionType === action.id &&
      event.args.timestamp === timestamp, "Game event does not match wallet, action or block");
    requireReceipt(Array.from({ length: 10 }, (_, n) => BigInt(action.basePoints * 2 ** n)).includes(event.args.pointsEarned),
      "Invalid game point award");
    for (const invite of invites) requireReceipt(invite.args.user.toLowerCase() === wallet &&
      invite.args.timestamp === timestamp, "Invalid invite event");
    return { points: safeNumber(event.args.pointsEarned), invites: invites.length, timestamp, streak: 0 };
  }
  requireReceipt(call.functionName === "dailyCheckin" && tx.value === 0n, "Not a daily check-in");
  const checkins = events.filter((e) => e.eventName === "StreakCheckin");
  requireReceipt(checkins.length === 1, "Missing or ambiguous check-in event");
  const event = checkins[0];
  requireReceipt(event.args.user.toLowerCase() === wallet && event.args.timestamp === timestamp &&
    event.args.currentStreak >= 1n, "Invalid check-in event");
  return { points: 0, invites: 0, timestamp, streak: safeNumber(event.args.currentStreak) };
}
export async function verifyRewardReceipt(kind: "game" | "checkin", hash: string, wallet: string) {
  requireReceipt(/^0x[0-9a-fA-F]{64}$/.test(hash), "Confirmed transaction hash required");
  await checkGameDeployment();
  const txHash = hash as `0x${string}`;
  const receipt = await gameRpc.getTransactionReceipt({ hash: txHash }).catch((e: unknown) => {
    if (e instanceof Error && e.name === "TransactionReceiptNotFoundError") throw new InvalidReceiptError("Transaction is not yet confirmed");
    throw e;
  });
  const [tx, block] = await Promise.all([
    gameRpc.getTransaction({ hash: txHash }), gameRpc.getBlock({ blockHash: receipt.blockHash }),
  ]);
  return validateRewardReceipt(kind, wallet, tx, receipt, block.timestamp);
}