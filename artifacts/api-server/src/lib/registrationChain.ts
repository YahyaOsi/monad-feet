import { createPublicClient, decodeEventLog, decodeFunctionData, http, parseAbi, type PublicClient } from "viem";
import { CHAIN_ID, REGISTRY } from "./chainConfig";

export const registrationAbi = parseAbi([
  "function registerUser(string username, string inviteCode)",
  "function users(address) view returns (bool registered, string username, uint256 registeredAt, uint256 postCount, uint256 likesSent, uint256 streakPoints, uint256 currentStreak, uint256 longestStreak, uint256 lastCheckin, string name, string bio, string avatarUri)",
  "event UserRegistered(address indexed wallet, string username, uint256 timestamp)",
]);
const rpc = createPublicClient({ transport: http("https://rpc.monad.xyz") });
const hashValid = (hash: string) => /^0x[0-9a-fA-F]{64}$/.test(hash);

type CallFrame = {
  type?: string; from?: string; to?: string; input?: `0x${string}`;
  value?: string; error?: unknown; calls?: CallFrame[];
};

// Relayed/delegated wallets have a different outer transaction sender. Prove
// the actual EVM CALL sender, never infer it from a calldata substring or event
// alone. Trace data comes only from our server's chain RPC, never the client.
export function tracedRegistrationInputs(trace: CallFrame, tx: { from: string; to: string | null; input: string; value: bigint }, wallet: string): `0x${string}`[] {
  if (!trace || trace.type !== "CALL" || trace.from?.toLowerCase() !== tx.from.toLowerCase() ||
      trace.to?.toLowerCase() !== tx.to?.toLowerCase() || trace.input !== tx.input ||
      !trace.value || BigInt(trace.value) !== tx.value || trace.error != null) return [];
  const inputs: `0x${string}`[] = [];
  let visited = 0;
  function visit(frame: CallFrame, depth: number) {
    if (++visited > 4096 || depth > 128) throw new Error("Registration trace limit exceeded");
    if (frame.error != null) return; // reverted ancestors roll back descendants
    if (frame.type === "CALL" && frame.from?.toLowerCase() === wallet &&
        frame.to?.toLowerCase() === REGISTRY.toLowerCase() && frame.value &&
        BigInt(frame.value) === 0n && typeof frame.input === "string") inputs.push(frame.input);
    if (frame.calls) {
      if (!Array.isArray(frame.calls)) throw new Error("Malformed registration trace");
      for (const child of frame.calls) visit(child, depth + 1);
    }
  }
  visit(trace, 0);
  return inputs;
}

export async function verifyRegistration(hash: string, wallet: string, client: PublicClient = rpc): Promise<boolean> {
  if (!hashValid(hash)) return false;
  wallet = wallet.toLowerCase();
  if (await client.getChainId() !== CHAIN_ID) throw new Error("Wrong registration chain");
  const receipt = await client.getTransactionReceipt({ hash: hash as `0x${string}` });
  const tx = await client.getTransaction({ hash: hash as `0x${string}` });
  if (receipt.status !== "success" || receipt.transactionHash.toLowerCase() !== hash.toLowerCase() ||
      tx.hash.toLowerCase() !== hash.toLowerCase() || tx.blockHash !== receipt.blockHash ||
      tx.blockNumber !== receipt.blockNumber || tx.chainId !== CHAIN_ID ||
      receipt.to?.toLowerCase() !== tx.to?.toLowerCase() || !tx.to ||
      receipt.from.toLowerCase() !== tx.from.toLowerCase() || tx.value !== 0n) return false;
  const state = await client.readContract({
    address: REGISTRY, abi: registrationAbi, functionName: "users", args: [wallet as `0x${string}`],
  });
  const block = await client.getBlock({ blockNumber: receipt.blockNumber });
  if (block.hash !== receipt.blockHash || !state[0] || block.timestamp !== state[2]) return false;
  const hasEvent = receipt.logs.some(log => {
      if (log.address.toLowerCase() !== REGISTRY.toLowerCase()) return false;
      try {
        const event = decodeEventLog({ abi: registrationAbi, data: log.data, topics: log.topics });
        return event.eventName === "UserRegistered" && event.args.wallet.toLowerCase() === wallet &&
          event.args.username === state[1] && event.args.timestamp === state[2];
      } catch { return false; }
  });
  if (!hasEvent) return false;
  let inputs: `0x${string}`[];
  if (tx.from.toLowerCase() === wallet && tx.to.toLowerCase() === REGISTRY.toLowerCase()) {
    inputs = [tx.input];
  } else {
    // RPC errors propagate: unsupported/unavailable tracing must fail closed.
    const trace = await client.request({
      method: "debug_traceTransaction",
      params: [hash, { tracer: "callTracer" }],
    } as never) as unknown as CallFrame;
    inputs = tracedRegistrationInputs(trace, tx, wallet);
  }
  // Both deployed contract sources ignore inviteCode. The historical calldata
  // is NOT admission authority. A fresh unused app invite is checked in SQL.
  return inputs.filter(data => {
    try {
      const input = decodeFunctionData({ abi: registrationAbi, data });
      return input.functionName === "registerUser" && input.args[0] === state[1];
    } catch { return false; }
  }).length === 1;
}

export async function discoverRegistration(wallet: string, client: PublicClient = rpc): Promise<{ registered: boolean; txHash: string | null }> {
  if (await client.getChainId() !== CHAIN_ID) throw new Error("Wrong registration chain");
  const state = await client.readContract({
    address: REGISTRY, abi: registrationAbi, functionName: "users", args: [wallet as `0x${string}`],
  });
  if (!state[0]) return { registered: false, txHash: null };
  const latest = await client.getBlockNumber();
  // Find the complete timestamp interval using two bounded binary searches.
  // Never scan the full chain: at most 256 blocks and 4 getLogs requests.
  async function boundary(strict: boolean) {
    let lo = 0n, hi = latest + 1n, calls = 0;
    while (lo < hi) {
      if (++calls > 64) throw new Error("Registration block search limit exceeded");
      const mid = (lo + hi) / 2n;
      const block = await client.getBlock({ blockNumber: mid });
      if (strict ? block.timestamp <= state[2] : block.timestamp < state[2]) lo = mid + 1n;
      else hi = mid;
    }
    return lo;
  }
  const from = await boundary(false), end = await boundary(true);
  if (from > latest || end <= from || end - from > 256n) throw new Error("Registration block interval unavailable");
  const hashes = new Set<string>();
  for (let start = from; start < end; start += 64n) {
    const logs = await client.getLogs({
      address: REGISTRY, event: registrationAbi[2], args: { wallet: wallet as `0x${string}` },
      fromBlock: start, toBlock: start + 63n < end ? start + 63n : end - 1n, strict: true,
    });
    for (const log of logs) if (!log.removed && log.transactionHash &&
      log.args.username === state[1] && log.args.timestamp === state[2]) hashes.add(log.transactionHash);
  }
  if (hashes.size !== 1) throw new Error("Original registration could not be uniquely recovered");
  const [txHash] = hashes;
  if (!await verifyRegistration(txHash, wallet, client)) throw new Error("Recovered registration failed verification");
  return { registered: true, txHash };
}

export function normalizeRegistrationUsername(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const username = value.trim().toLowerCase();
  return /^[a-z0-9_]{3,32}$/.test(username) ? username : null;
}

export function isUniqueViolation(error: unknown): boolean {
  const seen = new Set<unknown>();
  while (error && typeof error === "object" && !seen.has(error)) {
    seen.add(error);
    if ("code" in error && error.code === "23505") return true;
    error = "cause" in error ? error.cause : null;
  }
  return false;
}