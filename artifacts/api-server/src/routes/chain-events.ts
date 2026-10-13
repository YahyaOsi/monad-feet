import { Router } from "express";
import { decodeEventLog, parseAbi } from "viem";
import { and, desc, eq } from "drizzle-orm";
import { db, chainRewardClaimsTable, verifiedRegistrationsTable } from "@workspace/db";
import { gameRpc, checkGameDeployment } from "../lib/gameChain";
import { REGISTRY } from "../lib/chainConfig";
const router = Router();
const abi = parseAbi([
  "event UserRegistered(address indexed wallet, string username, uint256 timestamp)",
  "event PostCreated(address indexed author, uint256 indexed postId, string contentUri, uint256 timestamp)",
  "event PostLiked(address indexed liker, uint256 indexed postId, uint256 timestamp)",
  "event Subscribed(address indexed subscriber, address indexed creator, uint256 priceWei, uint256 expiresAt)",
  "event StreakCheckin(address indexed user, uint256 currentStreak, uint256 totalPoints, uint256 timestamp)",
  "event ProfileUpdated(address indexed wallet, string name, string bio, string avatarUri, uint256 timestamp)",
  "event GamePlayed(address indexed user, uint8 actionType, uint256 pointsEarned, uint256 timestamp)",
  "event InviteEarned(address indexed user, uint256 timestamp)",
]);
const labels: Record<string, string> = {
  UserRegistered: "A new member joined", PostCreated: "A post was recorded on chain",
  PostLiked: "A post received a like", Subscribed: "A creator gained a subscriber",
  StreakCheckin: "A member checked in", ProfileUpdated: "A profile was updated",
  GamePlayed: "A foot spa visit was completed", InviteEarned: "The contract recorded an invite event",
};
type Event = { id: string; kind: string; label: string; sublabel: string; txHash: string; at: string };
let events: Event[] = [];
let cursor: bigint | null = null;
let refreshed = 0;
let pending: Promise<void> | null = null;
async function refresh() {
  await checkGameDeployment();
  const head = await gameRpc.getBlockNumber();
  const recent = head > 511n ? head - 511n : 0n;
  const from = cursor === null ? recent : (cursor > recent + 8n ? cursor - 8n : recent);
  const discovered: Event[] = [];
  if (cursor === null) {
    const registrations = await db.select().from(verifiedRegistrationsTable)
      .orderBy(desc(verifiedRegistrationsTable.verifiedAt)).limit(10);
    for (const registration of registrations) {
      const receipt = await gameRpc.getTransactionReceipt({ hash: registration.txHash as `0x${string}` });
      if (receipt.status !== "success") continue;
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== REGISTRY.toLowerCase()) continue;
        try {
          const decoded = decodeEventLog({ abi, data: log.data, topics: log.topics });
          if (decoded.eventName !== "UserRegistered") continue;
          discovered.push({ id: `${registration.txHash}:${log.logIndex}`, kind: decoded.eventName,
            label: labels.UserRegistered, sublabel: `Block ${receipt.blockNumber}`, txHash: registration.txHash,
            at: new Date(Number(decoded.args.timestamp) * 1000).toISOString() });
        } catch { /* Other contract events are not registration history. */ }
      }
    }
  }
  for (let start = from; start <= head; start += 64n) {
    const logs = await gameRpc.getLogs({ address: REGISTRY, fromBlock: start, toBlock: start + 63n < head ? start + 63n : head });
    for (const log of logs) {
      if (!log.transactionHash || log.removed) continue;
      let decoded;
      try { decoded = decodeEventLog({ abi, data: log.data, topics: log.topics }); } catch { continue; }
      const block = await gameRpc.getBlock({ blockNumber: log.blockNumber });
      discovered.push({ id: `${log.transactionHash}:${log.logIndex}`, kind: decoded.eventName,
        label: labels[decoded.eventName], sublabel: `Block ${log.blockNumber}`, txHash: log.transactionHash,
        at: new Date(Number(block.timestamp) * 1000).toISOString() });
    }
  }
  const history = await db.select().from(chainRewardClaimsTable).where(and(
    eq(chainRewardClaimsTable.contractAddress, REGISTRY.toLowerCase())))
    .orderBy(desc(chainRewardClaimsTable.blockTimestamp)).limit(40);
  const seeded = history.filter(c => !discovered.some(e => e.txHash === c.txHash) && !events.some(e => e.txHash === c.txHash))
    .map(c => ({ id: `${c.txHash}:saved`, kind: c.kind === "game" ? "GamePlayed" : "StreakCheckin",
      label: c.kind === "game" ? labels.GamePlayed : labels.StreakCheckin, sublabel: "Confirmed transaction",
      txHash: c.txHash, at: c.blockTimestamp.toISOString() }));
  const all = new Map([...events.filter(e => !discovered.some(d => d.txHash === e.txHash)), ...seeded, ...discovered].map(e => [e.id, e]));
  events = [...all.values()].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, 50);
  cursor = head; refreshed = Date.now();
}
router.get("/chain/events", async (_req, res) => {
  try {
    if (Date.now() - refreshed > 15_000) {
      pending ??= refresh().finally(() => { pending = null; });
      await pending;
    }
    res.json({ events, latestBlock: String(cursor ?? 0), updatedAt: new Date(refreshed).toISOString() });
  } catch { res.status(503).json({ error: "Could not load chain events. Please retry." }); }
});
export default router;
