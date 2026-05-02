import { WebSocketServer, type WebSocket } from "ws";
import type { Server as HttpServer, IncomingMessage } from "http";
import { logger } from "./lib/logger";

export type PresenceUser = {
  userId: number;
  walletAddress: string;
  name: string | null;
  username: string | null;
  avatarUrl: string | null;
  connectedAt: string;
};

interface ExtWS extends WebSocket {
  __isAlive?: boolean;
}

const clients = new Map<ExtWS, PresenceUser>();

export function getOnlineUsers(): PresenceUser[] {
  return Array.from(clients.values());
}

function broadcast() {
  const msg = JSON.stringify({ type: "presence", users: getOnlineUsers() });
  for (const [ws] of clients) {
    if (ws.readyState === 1 /* OPEN */) {
      try { ws.send(msg); } catch { /* skip */ }
    }
  }
}

export function setupPresence(server: HttpServer): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request: IncomingMessage, socket, head) => {
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    wss.handleUpgrade(request, socket as any, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  });

  wss.on("connection", (ws: ExtWS, request: IncomingMessage) => {
    const rawUrl = request.url ?? "";
    let url: URL;
    try {
      url = new URL(rawUrl, `http://${request.headers.host ?? "localhost"}`);
    } catch {
      ws.close();
      return;
    }

    const walletAddress = url.searchParams.get("wallet") ?? "";
    const userId = parseInt(url.searchParams.get("userId") ?? "0", 10);
    const name = url.searchParams.get("name") || null;
    const username = url.searchParams.get("username") || null;
    const avatarUrl = url.searchParams.get("avatarUrl") || null;

    ws.__isAlive = true;
    clients.set(ws, {
      userId,
      walletAddress,
      name,
      username,
      avatarUrl,
      connectedAt: new Date().toISOString(),
    });

    logger.info({ userId, username }, "Presence: user connected");

    // Send current list immediately to this new client
    try {
      ws.send(JSON.stringify({ type: "presence", users: getOnlineUsers() }));
    } catch { /* skip */ }

    // Broadcast join to everyone
    broadcast();

    ws.on("pong", () => {
      ws.__isAlive = true;
    });

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(String(raw));
        if (msg.type === "ping") {
          ws.send(JSON.stringify({ type: "pong" }));
        }
      } catch { /* skip */ }
    });

    ws.on("close", () => {
      clients.delete(ws);
      logger.info({ userId, username }, "Presence: user disconnected");
      broadcast();
    });

    ws.on("error", () => {
      clients.delete(ws);
      broadcast();
    });
  });

  // Heartbeat — kick dead connections every 45s
  const heartbeat = setInterval(() => {
    for (const [ws] of clients) {
      if (!ws.__isAlive) {
        const user = clients.get(ws);
        logger.info({ userId: user?.userId }, "Presence: heartbeat evict");
        clients.delete(ws);
        ws.terminate();
      } else {
        ws.__isAlive = false;
        ws.ping();
      }
    }
    broadcast();
  }, 45_000);

  wss.on("close", () => clearInterval(heartbeat));

  logger.info("Presence WebSocket server initialized on /api/ws");
}
