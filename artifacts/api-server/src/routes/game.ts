import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db, usersTable, chainRewardClaimsTable } from "@workspace/db";
import { ClaimGameBody } from "@workspace/api-zod";
import { CHAIN_ID, REGISTRY, TREASURY, GAME_ENABLED, GAME_DISABLED_REASON } from "../lib/chainConfig";
import { gameRpc, gameAbi, checkGameDeployment, gameActionState, safeNumber, verifyRewardReceipt, InvalidReceiptError } from "../lib/gameChain";
import { gameClaimKey as claimKey, gameAward as award, saveVerifiedGameReward } from "../lib/gameRewards";

const router: IRouter = Router();
const contractAddress = REGISTRY.toLowerCase();
const identity = (req: { headers: Record<string, unknown> }) => String(req.headers["x-wallet-address"] ?? "").toLowerCase();

router.get("/game", async (req, res): Promise<void> => {
  const wallet = identity(req);
  if (!wallet) { res.status(401).json({ error: "Signed wallet session required" }); return; }
  try {
    await checkGameDeployment();
    const block = await gameRpc.getBlock();
    const [state, user] = await Promise.all([
      gameRpc.readContract({ address: REGISTRY, abi: gameAbi, functionName: "gameStates", args: [wallet as `0x${string}`], blockNumber: block.number }),
      gameRpc.readContract({ address: REGISTRY, abi: gameAbi, functionName: "users", args: [wallet as `0x${string}`], blockNumber: block.number }),
    ]);
    const day = block.timestamp / 86400n;
    res.json({
      contractAddress: REGISTRY, treasuryAddress: TREASURY, chainId: CHAIN_ID,
      enabled: GAME_ENABLED, disabledReason: GAME_ENABLED ? "" : GAME_DISABLED_REASON,
      registered: user[0], utcDay: new Date(safeNumber(day) * 86400000).toISOString().slice(0, 10),
      nextResetAt: new Date(safeNumber(day + 1n) * 86400000).toISOString(),
      totalPurchases: safeNumber(state[4]), purchasesUntilInvite: 5 - Number(state[4] % 5n),
      actions: gameActionState(day, state), onChainPoints: safeNumber(user[5]),
      currentStreak: safeNumber(user[6]), longestStreak: safeNumber(user[7]),
      checkedInToday: user[8] > 0n && user[8] / 86400n === day,
    });
  } catch {
    res.status(503).json({ error: "Live Monad game state is unavailable or deployment checks failed. No purchase was sent." });
  }
});

router.get("/game/claims", async (req, res): Promise<void> => {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.walletAddress, identity(req)));
  if (!user) { res.status(401).json({ error: "Registered signed wallet required" }); return; }
  const claims = await db.select().from(chainRewardClaimsTable)
    .where(and(eq(chainRewardClaimsTable.userId, user.id), eq(chainRewardClaimsTable.contractAddress, contractAddress), eq(chainRewardClaimsTable.kind, "game")))
    .orderBy(desc(chainRewardClaimsTable.createdAt)).limit(20);
  res.json({ claims: claims.map((c) => ({ txHash: c.txHash, pointsAwarded: c.pointsAwarded, invitesAwarded: c.inviteCodes.length, createdAt: c.createdAt })) });
});

router.post("/game/claims", async (req, res): Promise<void> => {
  const parsed = ClaimGameBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "A valid transaction hash is required" }); return; }
  const wallet = identity(req);
  const [user] = await db.select().from(usersTable).where(eq(usersTable.walletAddress, wallet));
  if (!user) { res.status(401).json({ error: "Registered signed wallet required" }); return; }
  const hash = parsed.data.txHash.toLowerCase();
  const [previous] = await db.select().from(chainRewardClaimsTable).where(claimKey(hash));
  if (previous) {
    if (previous.userId !== user.id || previous.kind !== "game") { res.status(409).json({ error: "Transaction already claimed by another action or wallet" }); return; }
    res.json(award(previous, true)); return;
  }
  // Sending can be disabled independently of recovery of already-confirmed payments.
  let verified;
  try { verified = await verifyRewardReceipt("game", hash, wallet); }
  catch (e) {
    res.status(e instanceof InvalidReceiptError ? 422 : 503).json({ error: e instanceof InvalidReceiptError ? e.message : "Monad verification unavailable; keep this hash and retry. Do not pay again." }); return;
  }
  const result = await saveVerifiedGameReward(user.id, hash, verified);
  res.json(result);
});
export default router;