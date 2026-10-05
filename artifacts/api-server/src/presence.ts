import { WebSocketServer, type WebSocket } from "ws";
import type { Server as HttpServer, IncomingMessage } from "http";
import { logger } from "./lib/logger";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { usersTable } from "@workspace/db";
import { expectedOrigin, hasVerifiedRegistration, sessionWallet } from "./lib/walletAuth";

export type PresenceUser = {
  userId: number;
  walletAddress: string;
  name: string | null;
  username: string | null;
  avatarUrl: string | null;
  connectedAt: string;
};

export type PostPayload = {
  id: number;
  content: string | null;
  imageUrl: string | null;
  authorId: number;
  authorName: string | null;
  authorUsername: string | null;
  authorAvatarUrl: string | null;
  onChainTxHash: string | null;
  likeCount: number;
  likedByMe: boolean;
  createdAt: string | Date;
};

export type ActivityEvent =
  | { type: "post_created"; post: PostPayload; actorId: number }
  | { type: "post_liked"; postId: number; likeCount: number; actorId: number }
  | { type: "post_anchored"; postId: number; txHash: string }
  | { type: "trending_alert"; postId: number; rank: number; postContent: string | null }
  | { type: "badge_earned"; userId: number; badge: { badgeType: string; label: string; description: string; emoji: string } }
  | { type: "new_dm"; messageId: number; senderId: number; senderName: string | null; senderAvatarUrl: string | null; preview: string }
  | { type: "new_subscription"; subscriberId: number; subscriberName: string | null; subscriberUsername: string | null; subscriberAvatarUrl: string | null; isRenewal: boolean }
  | { type: "invite_codes_earned"; userId: number; codes: number; reason: string };

interface ExtWS extends WebSocket {
  __isAlive?: boolean;
  __cookie?: string;
}

const clients = new Map<ExtWS, PresenceUser>();

export function closeWalletSockets(wallet: string): void {
  for (const [ws, user] of clients) if (user.walletAddress === wallet) ws.close(1008, "Session ended");
}

// In-memory snapshot of which post IDs are currently in the top 3
let currentTop3 = new Set<number>();

export function getOnlineUsers(): PresenceUser[] {
  // Presence broadcasts have no per-recipient media entitlement. Clients load
  // authorized avatars through the protected profile endpoint instead.
  const members = new Map<number, PresenceUser>();
  for (const [ws, user] of clients) {
    if (ws.readyState === 1 && !members.has(user.userId)) {
      members.set(user.userId, { ...user, avatarUrl: null });
    }
  }
  return Array.from(members.values());
}

function broadcastAll(msg: string) {
  for (const [ws] of clients) {
    if (ws.readyState === 1 /* OPEN */) {
      try { ws.send(msg); } catch { /* skip */ }
    }
  }
}

function broadcastToUser(userId: number, msg: string) {
  for (const [ws, user] of clients) {
    if (user.userId === userId && ws.readyState === 1) {
      try { ws.send(msg); } catch { /* skip */ }
    }
  }
}

function broadcastPresence() {
  broadcastAll(JSON.stringify({ type: "presence", users: getOnlineUsers() }));
}

/** Send an activity event to every connected client. */
export function broadcastActivity(event: ActivityEvent): void {
  broadcastAll(JSON.stringify({ type: "activity", event }));
}

/** Send an activity event to a single user (by userId) only. */
export function notifyUser(userId: number, event: ActivityEvent): void {
  broadcastToUser(userId, JSON.stringify({ type: "activity", event }, (key, value) =>
    /avatarUrl$/i.test(key) ? null : value));
}

/**
 * After a like, recalculate the top-3 by velocity.
 * If the liked post just entered the top 3 for the first time,
 * send a `trending_alert` to the post's author via their WebSocket.
 */
export async function checkAndNotifyTrending(
  postId: number,
  authorId: number,
  postContent: string | null,
): Promise<void> {
  const authorOnline = Array.from(clients.values()).some((u) => u.userId === authorId);
  if (!authorOnline) return;

  try {
    const result = await db.execute(sql`
      SELECT p.id
      FROM posts p
      LEFT JOIN post_likes rpl
        ON rpl.post_id = p.id
       AND rpl.created_at > NOW() - INTERVAL '24 hours'
      WHERE p.created_at > NOW() - INTERVAL '7 days'
      GROUP BY p.id
      ORDER BY
        COUNT(DISTINCT rpl.id)::float /
        GREATEST(1.0, 1.0 + 0.3 * EXTRACT(EPOCH FROM (NOW() - p.created_at)) / 3600.0) DESC
      LIMIT 3
    `);

    const raw = result as unknown as { rows?: { id: number }[] };
    const top3Ids: number[] = (
      Array.isArray(result)
        ? (result as unknown as { id: number }[])
        : (raw.rows ?? [])
    ).map((r) => r.id);

    const newTop3 = new Set(top3Ids);

    if (newTop3.has(postId) && !currentTop3.has(postId)) {
      const rank = top3Ids.indexOf(postId) + 1;
      notifyUser(authorId, { type: "trending_alert", postId, rank, postContent });
      logger.info({ postId, authorId, rank }, "Trending alert sent");
    }

    currentTop3 = newTop3;
  } catch {
    // Non-critical — fail silently
  }
}

export function setupPresence(server: HttpServer): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", async (request: IncomingMessage, socket, head) => {
    const rawUrl = request.url ?? "";
    let pathname: string;
    try {
      pathname = new URL(rawUrl, `http://${request.headers.host ?? "localhost"}`).pathname;
    } catch {
      socket.destroy();
      return;
    }

    if (pathname !== "/api/ws") {
      socket.destroy();
      return;
    }

    // Browser cookies are sent on WebSocket handshakes. Require the same
    // origin and resolve identity only from the server-side session.
    if (!expectedOrigin(request) || !request.headers.origin) { socket.destroy(); return; }
    let wallet: string | null;
    let user: typeof usersTable.$inferSelect | undefined;
    try {
      wallet = await sessionWallet(request.headers.cookie);
      if (wallet) [user] = await db.select().from(usersTable).where(eq(usersTable.walletAddress, wallet));
    }
    catch { socket.destroy(); return; }
    if (!wallet || !user || !await hasVerifiedRegistration(user).catch(() => false)) {
      socket.destroy(); return;
    }
    const url = new URL(request.url ?? "", `http://${request.headers.host}`);
    const requestedWallet = url.searchParams.get("wallet");
    const requestedId = url.searchParams.get("userId");
    if ((requestedWallet && requestedWallet.toLowerCase() !== wallet) ||
        (requestedId && requestedId !== String(user.id))) { socket.destroy(); return; }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    wss.handleUpgrade(request, socket as any, head, (ws) => {
      wss.emit("connection", ws, user, request.headers.cookie);
    });
  });

  wss.on("connection", (ws: ExtWS, user: typeof usersTable.$inferSelect, cookie: string | undefined) => {
    const { id: userId, walletAddress, name, username, avatarUrl } = user;

    ws.__isAlive = true;
    ws.__cookie = cookie;
    clients.set(ws, {
      userId,
      walletAddress,
      name,
      username,
      avatarUrl,
      connectedAt: new Date().toISOString(),
    });

    logger.info({ userId, username }, "Presence: user connected");

    try {
      ws.send(JSON.stringify({ type: "presence", users: getOnlineUsers() }));
    } catch { /* skip */ }

    broadcastPresence();

    ws.on("pong", () => { ws.__isAlive = true; });

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(String(raw)) as { type?: string };
        if (msg.type === "ping") {
          ws.send(JSON.stringify({ type: "pong" }));
        }
      } catch { /* skip */ }
    });

    ws.on("close", () => {
      clients.delete(ws);
      logger.info({ userId, username }, "Presence: user disconnected");
      broadcastPresence();
    });

    ws.on("error", () => {
      clients.delete(ws);
      broadcastPresence();
    });
  });

  // Heartbeat — evict dead connections every 45s
  const heartbeat = setInterval(async () => {
    for (const [ws] of clients) {
      let stillAuthorized = false;
      try {
        const connection = clients.get(ws);
        if (connection && await sessionWallet(ws.__cookie) === connection.walletAddress) {
          const [user] = await db.select().from(usersTable).where(eq(usersTable.id, connection.userId));
          stillAuthorized = !!user && await hasVerifiedRegistration(user);
        }
      }
      catch { /* fail closed */ }
      if (!ws.__isAlive || !stillAuthorized) {
        const user = clients.get(ws);
        logger.info({ userId: user?.userId }, "Presence: heartbeat evict");
        clients.delete(ws);
        ws.terminate();
      } else {
        ws.__isAlive = false;
        ws.ping();
      }
    }
    broadcastPresence();
  }, 45_000);

  wss.on("close", () => clearInterval(heartbeat));
  server.once("close", () => wss.close());

  logger.info("Presence WebSocket server initialized on /api/ws");
}
