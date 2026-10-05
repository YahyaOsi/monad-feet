import { randomBytes, randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { eq, lt } from "drizzle-orm";
import { closeWalletSockets } from "../presence";
import { db, walletChallengesTable, walletSessionsTable } from "@workspace/db";
import {
  addressValid, allowAttempt, challengeMessage, CHALLENGE_MS, clearCookie,
  expectedOrigin, issueCookie, normalizeWallet, readCookie, sessionWallet,
  tokenHash, verifyChallenge,
} from "../lib/walletAuth";

const router: IRouter = Router();

router.get("/auth/session", async (req, res) => {
  res.json({ walletAddress: await sessionWallet(req.headers.cookie) });
});

router.post("/auth/challenge", async (req, res) => {
  const origin = expectedOrigin(req);
  if (!origin) { res.status(403).json({ error: "Same-origin request required" }); return; }
  const address = req.body?.walletAddress;
  if (!addressValid(address)) { res.status(400).json({ error: "Invalid wallet address" }); return; }
  const normalized = normalizeWallet(address);
  if (!allowAttempt(`challenge:${req.ip}:${normalized}`, 5) || !allowAttempt(`challenge-ip:${req.ip}`, 100)) {
    res.status(429).json({ error: "Too many challenges" }); return;
  }
  const issued = new Date();
  // Opportunistically remove stale records without a background migration
  // job or deleting any still-usable challenge/session.
  if (randomBytes(1)[0] < 8) {
    await db.delete(walletChallengesTable).where(lt(walletChallengesTable.expiresAt, issued));
    await db.delete(walletSessionsTable).where(lt(walletSessionsTable.expiresAt, issued));
  }
  const expires = new Date(issued.getTime() + CHALLENGE_MS);
  const message = challengeMessage(normalized, origin, randomBytes(16).toString("hex"), issued, expires);
  await db.insert(walletChallengesTable).values({
    id: randomUUID(), walletAddress: normalized, origin, message, expiresAt: expires,
  });
  res.json({ message });
});

router.post("/auth/verify", async (req, res) => {
  const origin = expectedOrigin(req);
  if (!origin) { res.status(403).json({ error: "Same-origin request required" }); return; }
  if (!allowAttempt(`verify-ip:${req.ip}`, 100)) { res.status(429).json({ error: "Too many attempts" }); return; }
  const { walletAddress, message, signature } = req.body ?? {};
  if (!addressValid(walletAddress) || typeof message !== "string" || message.length > 1000 ||
      typeof signature !== "string" || !/^0x(?:[0-9a-fA-F]{2})+$/.test(signature) || signature.length > 8194) {
    res.status(400).json({ error: "Invalid signature request" }); return;
  }
  let token: string | null;
  try {
    token = await verifyChallenge(walletAddress, message, signature as `0x${string}`, origin);
  } catch {
    res.status(503).json({ error: "Wallet verification unavailable; please retry" }); return;
  }
  if (!token) { res.status(401).json({ error: "Challenge expired, replayed or signature invalid" }); return; }
  const previous = readCookie(req.headers.cookie);
  if (previous) await db.delete(walletSessionsTable).where(eq(walletSessionsTable.tokenHash, tokenHash(previous)));
  res.setHeader("Set-Cookie", issueCookie(token));
  res.json({ walletAddress: normalizeWallet(walletAddress) });
});

router.post("/auth/logout", async (req, res) => {
  const token = readCookie(req.headers.cookie);
  const wallet = await sessionWallet(req.headers.cookie);
  if (token) await db.delete(walletSessionsTable).where(eq(walletSessionsTable.tokenHash, tokenHash(token)));
  if (wallet) closeWalletSockets(wallet);
  res.setHeader("Set-Cookie", clearCookie());
  res.sendStatus(204);
});

export default router;