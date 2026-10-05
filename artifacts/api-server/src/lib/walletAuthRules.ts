import { createHash } from "node:crypto";
import { isAddress } from "viem";

export const COOKIE_NAME = "mf_session";
export const SESSION_SECONDS = 7 * 24 * 60 * 60;
export const CHALLENGE_MS = 5 * 60 * 1000;
export const CHAIN_ID = 143;
export const addressValid = (value: unknown): value is `0x${string}` =>
  typeof value === "string" && isAddress(value);
export const normalizeWallet = (value: `0x${string}`) => value.toLowerCase();
export const tokenHash = (value: string) => createHash("sha256").update(value).digest("hex");

export function expectedOrigin(req: { headers: Record<string, unknown> }): string | null {
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (typeof origin !== "string" || typeof host !== "string") return null;
  try {
    const parsed = new URL(origin);
    if (parsed.host !== host || parsed.origin !== origin) return null;
    if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:") return null;
    if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host))) return null;
    return parsed.origin;
  } catch { return null; }
}

export function challengeMessage(address: string, origin: string, nonce: string, issued: Date, expires: Date): string {
  return `Monad Feet wallet sign-in\nDomain: ${new URL(origin).host}\nURI: ${origin}\nChain ID: ${CHAIN_ID}\nAddress: ${address}\nNonce: ${nonce}\nIssued At: ${issued.toISOString()}\nExpiration Time: ${expires.toISOString()}`;
}

export function challengeUsable(challenge: {
  walletAddress: string; origin: string; message: string; consumedAt: Date | null; expiresAt: Date;
}, walletAddress: string, origin: string, message: string, now = new Date()): boolean {
  return challenge.walletAddress === walletAddress && challenge.origin === origin &&
    challenge.message === message && challenge.consumedAt === null && challenge.expiresAt > now;
}

export function readCookie(header: string | undefined): string | null {
  const match = header?.split(";").map((v) => v.trim()).find((v) => v.startsWith(`${COOKIE_NAME}=`));
  const value = match?.slice(COOKIE_NAME.length + 1) ?? "";
  return /^[a-f0-9]{64}$/.test(value) ? value : null;
}

export function identityMismatch(value: unknown, wallet: string): boolean {
  return typeof value !== "string" || value.toLowerCase() !== wallet;
}