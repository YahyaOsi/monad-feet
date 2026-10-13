import { randomBytes } from "node:crypto";
import type { RequestHandler } from "express";
import { and, eq, gt } from "drizzle-orm";
import { createPublicClient, defineChain, http } from "viem";
import { db, usersTable, verifiedRegistrationsTable, walletChallengesTable, walletSessionsTable } from "@workspace/db";
import { COOKIE_NAME, SESSION_SECONDS, CHAIN_ID, tokenHash, normalizeWallet, expectedOrigin, readCookie, challengeUsable, identityMismatch } from "./walletAuthRules";
import { hasChogNft } from "./chog";
export { COOKIE_NAME, SESSION_SECONDS, CHALLENGE_MS, CHAIN_ID, tokenHash,
  normalizeWallet, expectedOrigin, challengeMessage, readCookie, addressValid } from "./walletAuthRules";

const chain = defineChain({
  id: CHAIN_ID, name: "Monad Mainnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.monad.xyz"] } },
});
const publicClient = createPublicClient({ chain, transport: http("https://rpc.monad.xyz") });

export async function sessionWallet(cookieHeader: string | undefined): Promise<string | null> {
  const cookie = readCookie(cookieHeader);
  if (!cookie) return null;
  const [row] = await db.select({ walletAddress: walletSessionsTable.walletAddress })
    .from(walletSessionsTable)
    .where(and(eq(walletSessionsTable.tokenHash, tokenHash(cookie)), gt(walletSessionsTable.expiresAt, new Date())));
  return row?.walletAddress ?? null;
}

// Only the server can insert this evidence, in the same transaction as a new
// user after checking chain ID, successful receipt, sender, calldata and event.
// Old registrationTxHash fields alone are untrusted; legacy accounts must be
// explicitly reconciled/migrated after independent receipt verification.
export async function hasVerifiedRegistration(user: typeof usersTable.$inferSelect): Promise<boolean> {
  if (!user.registrationTxHash) return false;
  const [evidence] = await db.select({ txHash: verifiedRegistrationsTable.txHash })
    .from(verifiedRegistrationsTable)
    .where(and(eq(verifiedRegistrationsTable.userId, user.id),
      eq(verifiedRegistrationsTable.txHash, user.registrationTxHash.toLowerCase())));
  return !!evidence;
}

export function issueCookie(token: string): string {
  return `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/api; Max-Age=${SESSION_SECONDS}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
}

export function clearCookie(): string {
  return `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/api; Max-Age=0${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
}

function isNumericPathId(value: string | undefined): boolean {
  if (!value || !/^[0-9]+$/.test(value)) return false;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 && id <= 2_147_483_647;
}

function isPublicShareRead(req: Parameters<RequestHandler>[0]): boolean {
  if (req.method !== "GET") return false;
  if (req.path === "/badges") return typeof req.query.userId === "string" && isNumericPathId(req.query.userId);
  if (req.path === "/posts") {
    const authorId = req.query.authorId;
    const numericId = typeof authorId === "string" && /^[0-9]+$/.test(authorId)
      ? Number(authorId)
      : NaN;
    return Number.isSafeInteger(numericId) && numericId > 0 && numericId <= 2_147_483_647;
  }
  const postCommentsPath = req.path.match(/^\/posts\/([^/]+)\/comments$/);
  const userProfilePath = req.path.match(/^\/users\/([^/]+)$/);
  const creatorPricePath = req.path.match(/^\/subscriptions\/price\/([^/]+)$/);
  if ((postCommentsPath && isNumericPathId(postCommentsPath[1])) ||
      (userProfilePath && isNumericPathId(userProfilePath[1])) ||
      (creatorPricePath && isNumericPathId(creatorPricePath[1])) ||
      /^\/storage\/(?:objects|public-objects)(?:\/|$)/.test(req.path)) return true;
  const postIdPath = req.path.match(/^\/posts\/([^/]+)$/);
  return !!postIdPath && isNumericPathId(postIdPath[1]);
}

export async function verifyChallenge(walletAddress: `0x${string}`, message: string, signature: `0x${string}`, origin: string): Promise<string | null> {
  const address = normalizeWallet(walletAddress);
  return db.transaction(async (tx) => {
    const [challenge] = await tx.select().from(walletChallengesTable)
      .where(and(eq(walletChallengesTable.message, message), eq(walletChallengesTable.walletAddress, address),
        eq(walletChallengesTable.origin, origin))).for("update");
    if (!challenge || !challengeUsable(challenge, address, origin, message)) return null;
    // viem's public client supports ERC-1271 smart accounts in addition to EOAs.
    const valid = await publicClient.verifyMessage({ address: walletAddress, message, signature });
    if (!valid) return null;
    await tx.update(walletChallengesTable).set({ consumedAt: new Date() })
      .where(eq(walletChallengesTable.id, challenge.id));
    const token = randomBytes(32).toString("hex");
    await tx.insert(walletSessionsTable).values({
      tokenHash: tokenHash(token), walletAddress: address,
      expiresAt: new Date(Date.now() + SESSION_SECONDS * 1000),
    });
    return token;
  });
}

// Bounded per-process abuse protection; a shared edge limiter is recommended
// when running multiple replicas.
const attempts = new Map<string, { count: number; reset: number }>();
export function allowAttempt(key: string, limit = 12, now = Date.now()): boolean {
  if (attempts.size > 10000) for (const [k, v] of attempts) if (v.reset <= now) attempts.delete(k);
  const previous = attempts.get(key);
  if (!previous && attempts.size > 10000) return false;
  if (!previous || previous.reset <= now) {
    attempts.set(key, { count: 1, reset: now + 60_000 }); return true;
  }
  previous.count++;
  return previous.count <= limit;
}

export const protectApi: RequestHandler = async (req, res, next) => {
  const supplied = req.headers["x-wallet-address"];
  delete req.headers["x-wallet-address"];
  if (req.method !== "GET" && req.method !== "HEAD" && !expectedOrigin(req)) {
    res.status(403).json({ error: "Same-origin request required", code: "SAME_ORIGIN_REQUIRED" }); return;
  }
  let wallet: string | null;
  try {
    wallet = await sessionWallet(req.headers.cookie);
  } catch (error) {
    if (req.path === "/auth/registration/prepare") {
      res.status(503).json({ error: "Session verification unavailable; please retry", code: "REGISTRATION_UNAVAILABLE" }); return;
    }
    throw error;
  }
  const publicShareRead = isPublicShareRead(req);
  const isPublic = req.path === "/healthz" ||
    (["/auth/session", "/auth/challenge", "/auth/verify", "/auth/logout"].includes(req.path)) ||
    (req.method === "GET" && (req.path === "/leaderboard" || req.path.startsWith("/leaderboard/"))) ||
    publicShareRead;
  if (!wallet && !isPublic) { res.status(401).json({ error: "Wallet authentication required", code: "AUTH_REQUIRED" }); return; }
  if (supplied && (!wallet || identityMismatch(Array.isArray(supplied) ? supplied[0] : supplied, wallet))) {
    res.status(403).json({ error: "Wallet header does not match signed session", code: "WALLET_MISMATCH" }); return;
  }
  let allowPublicIdentity = true;
  if (wallet && publicShareRead) {
    const [registered] = await db.select().from(usersTable).where(eq(usersTable.walletAddress, wallet));
    allowPublicIdentity = !!registered && await hasVerifiedRegistration(registered);
    if (allowPublicIdentity && registered?.admissionMethod === "chog") {
      try { allowPublicIdentity = await hasChogNft(wallet); } catch { allowPublicIdentity = false; }
    }
  }
  if (wallet && (!publicShareRead || allowPublicIdentity)) req.headers["x-wallet-address"] = wallet;
  if (wallet && !isPublic && req.path !== "/auth/register" && req.path !== "/auth/nft-access" && req.path !== "/auth/registration/prepare" && req.path !== "/invites/validate" &&
      !(req.path === "/users/me" && req.method === "GET")) {
    const [registered] = await db.select().from(usersTable).where(eq(usersTable.walletAddress, wallet));
    if (!registered) { res.status(403).json({ error: "Registration required" }); return; }
    if (!await hasVerifiedRegistration(registered)) {
      res.status(403).json({ error: "Verified on-chain registration required. Existing accounts require explicit receipt-verified migration." }); return;
    }
    if (registered.admissionMethod === "chog") {
      try {
        if (!await hasChogNft(wallet)) {
          res.status(403).json({ error: "Hold a CHOG Genesis NFT in your admission wallet to access member features.", code: "CHOG_REQUIRED" }); return;
        }
      } catch {
        res.status(503).json({ error: "CHOG ownership verification unavailable. Retry shortly." }); return;
      }
    }
  }

  if (wallet && req.body && typeof req.body === "object" && !Array.isArray(req.body)) {
    for (const [key, value] of Object.entries(req.body)) {
      if (/walletAddress$/i.test(key) && identityMismatch(value, wallet)) {
        res.status(403).json({ error: `${key} does not match signed session`, code: "WALLET_MISMATCH" }); return;
      }
    }
  }
  next();
};