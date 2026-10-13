import { parseAbiItem } from "viem";
import { gameRpc, gameAbi, verifyRewardReceipt } from "./gameChain";
import { REGISTRY } from "./chainConfig";
import { saveVerifiedCheckin } from "./checkinClaims";

const checked = new Map<string, { until: number; pending: Promise<void> }>();

export async function recoverLatestCheckin(user: { id: number; walletAddress: string; nftHolder: boolean }, savedAt: Date | null) {
  const wallet = user.walletAddress as `0x${string}`;
  const key = `${wallet}:${savedAt?.toISOString() ?? ""}`;
  const cached = checked.get(key);
  if (cached && cached.until > Date.now()) return cached.pending;
  const pending = (async () => {
    const state = await gameRpc.readContract({ address: REGISTRY, abi: gameAbi, functionName: "users", args: [wallet] });
    const timestamp = state[8];
    if (!state[0] || timestamp === 0n || timestamp <= BigInt(Math.floor((savedAt?.getTime() ?? 0) / 1000))) return;
    const head = await gameRpc.getBlock();
    // Locate the confirmed check in by block time instead of assuming an RPC
    // supports a scan of the entire chain.
    let low = 0n, high = head.number;
    while (low < high) {
      const mid = (low + high) / 2n;
      const block = await gameRpc.getBlock({ blockNumber: mid });
      if (block.timestamp < timestamp) low = mid + 1n;
      else high = mid;
    }
    const logs = await gameRpc.getLogs({
      address: REGISTRY,
      event: parseAbiItem("event StreakCheckin(address indexed user, uint256 currentStreak, uint256 totalPoints, uint256 timestamp)"),
      args: { user: wallet }, fromBlock: low,
      toBlock: low + 63n < head.number ? low + 63n : head.number,
    });
    const event = logs.find(log => log.args.timestamp === timestamp && log.transactionHash);
    if (!event?.transactionHash) throw new Error("Could not find the confirmed check in receipt");
    const verified = await verifyRewardReceipt("checkin", event.transactionHash, wallet);
    await saveVerifiedCheckin(user, event.transactionHash.toLowerCase(), verified);
  })();
  checked.set(key, { until: Date.now() + 30_000, pending });
  if (checked.size > 1000) checked.delete(checked.keys().next().value!);
  return pending;
}
