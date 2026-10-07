import { Router, type IRouter } from "express";
import { and, eq, gt, isNull } from "drizzle-orm";
import { createPublicClient, defineChain, http } from "viem";
import { db, creatorChallenges, creatorWorkspaces } from "@workspace/db";
import { CreateWalletChallengeBody, CreateWalletChallengeResponse, VerifyWalletBody, VerifyWalletResponse, EnterDemoResponse } from "../../lib/creator/contract";
import { accountView, endSession, getWorkspace, lock, newWorkspace, primaryMember, randomCode, requirePreview } from "../../lib/creator/session";
import { requireCondition } from "../../lib/creator/errors";

const router: IRouter = Router();
const signatures = createPublicClient({ chain: defineChain({
  id: 143, name: "Monad Mainnet", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.monad.xyz"] } },
}), transport: http("https://rpc.monad.xyz", { timeout: 8000 }) });
router.post("/session/applicant", async (req, res): Promise<void> => {
  const old = await getWorkspace(req, res);
  requirePreview(old);
  await endSession(res);
  const ws = await newWorkspace(req, res, "demo", undefined, true);
  res.json(EnterDemoResponse.parse(accountView(await primaryMember(ws), ws)));
});
router.post("/session/demo", async (req, res): Promise<void> => {
  const old = await getWorkspace(req, res, true);
  if (old.mode === "demo") { res.json(EnterDemoResponse.parse(accountView(await primaryMember(old), old))); return; }
  await endSession(res);
  const ws = await newWorkspace(req, res);
  res.json(EnterDemoResponse.parse(accountView(await primaryMember(ws), ws)));
});
router.post("/session/logout", async (req, res): Promise<void> => {
  const ws = await getWorkspace(req, res);
  await endSession(res);
  res.json({ message: "Wallet session ended. Open the preview to continue with sample data." });
});
router.post("/auth/challenge", async (req, res): Promise<void> => {
  const input = CreateWalletChallengeBody.parse(req.body);
  const ws = await getWorkspace(req, res);
  const id = randomCode();
  const expiresAt = new Date(Date.now() + 5 * 60000);
   const origin = req.get("origin") ?? `${req.secure ? "https" : "http"}://${req.get("host")}`;
  const host = new URL(origin).host;
  const message = `${host} wants you to sign in with your Ethereum account:\n${input.wallet}\n\nVerify wallet ownership for Monad Feet Creator Program. This does not authorize a payment or establish Monad Feet membership.\n\nURI: ${origin}\nVersion: 1\nChain ID: 143\nNonce: ${id}\nIssued At: ${new Date().toISOString()}\nExpiration Time: ${expiresAt.toISOString()}`;
  await db.transaction(async (tx) => {
    await lock(tx, ws.id);
    await tx.update(creatorChallenges).set({ usedAt: new Date() }).where(and(eq(creatorChallenges.sessionHash, res.locals.creatorSessionHash), isNull(creatorChallenges.usedAt)));
    await tx.insert(creatorChallenges).values({ id, workspaceId: ws.id, sessionHash: res.locals.creatorSessionHash, wallet: input.wallet.toLowerCase(), message, origin, expiresAt });
  });
  res.json(CreateWalletChallengeResponse.parse({ id, message, expiresAt: expiresAt.toISOString() }));
});
router.post("/auth/verify", async (req, res): Promise<void> => {
  const input = VerifyWalletBody.parse(req.body);
  const ws = await getWorkspace(req, res);
  const wallet = await db.transaction(async (tx) => {
    await lock(tx, ws.id);
    const [challenge] = await tx.select().from(creatorChallenges).where(and(
      eq(creatorChallenges.id, input.challengeId), eq(creatorChallenges.workspaceId, ws.id),
      eq(creatorChallenges.sessionHash, res.locals.creatorSessionHash),
      isNull(creatorChallenges.usedAt), gt(creatorChallenges.expiresAt, new Date()),
    ));
    requireCondition(challenge, "This login challenge expired or was already used. Connect again.", 401);
    const origin = req.get("origin");
    requireCondition(!origin || origin === challenge.origin, "The signature belongs to another origin.", 403);
    let valid = false;
    try { valid = await signatures.verifyMessage({ address: challenge.wallet as `0x${string}`, message: challenge.message, signature: input.signature as `0x${string}` }); } catch { /* Invalid or unavailable signatures fail closed. */ }
    requireCondition(valid, "Wallet signature could not be verified. Only supported wallet signatures are accepted.", 401);
    await tx.update(creatorChallenges).set({ usedAt: new Date() }).where(eq(creatorChallenges.id, challenge.id));
    return challenge.wallet;
  });
  const verified = await newWorkspace(req, res, "wallet", wallet);
  // The new cookie is already issued; revoke only the old browser session.
  const oldToken = req.cookies?.mf_creator_session;
  if (typeof oldToken === "string") {
    const { createHash } = await import("node:crypto");
    const { creatorSessions } = await import("@workspace/db");
    await db.delete(creatorSessions).where(eq(creatorSessions.tokenHash, createHash("sha256").update(oldToken).digest("hex")));
  }
  res.json(VerifyWalletResponse.parse(accountView(await primaryMember(verified), verified)));
});
export default router;
