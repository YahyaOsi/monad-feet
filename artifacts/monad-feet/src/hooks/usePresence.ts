import { useState, useEffect, useRef, useCallback } from "react";
import { useUser } from "@/context/UserContext";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export type OnlineUser = {
  userId: number;
  walletAddress: string;
  name: string | null;
  username: string | null;
  avatarUrl: string | null;
  connectedAt: string;
};

// Global singleton so all components share the same connection
let globalWs: WebSocket | null = null;
let globalListeners: Set<(users: OnlineUser[]) => void> = new Set();
let globalUsers: OnlineUser[] = [];
let globalConnected = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 1000;

function notifyAll(users: OnlineUser[]) {
  globalUsers = users;
  for (const fn of globalListeners) fn(users);
}

function connectWs(user: { id: number; walletAddress: string; name?: string | null; username?: string | null; avatarUrl?: string | null }) {
  if (globalWs && globalWs.readyState <= 1 /* CONNECTING or OPEN */) return;

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const params = new URLSearchParams({
    wallet: user.walletAddress,
    userId: String(user.id),
    name: user.name ?? "",
    username: user.username ?? "",
    avatarUrl: user.avatarUrl ?? "",
  });
  const url = `${protocol}//${window.location.host}/api/ws?${params}`;

  const ws = new WebSocket(url);
  globalWs = ws;

  ws.onopen = () => {
    globalConnected = true;
    reconnectDelay = 1000;
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(String(event.data)) as { type: string; users?: OnlineUser[] };
      if (data.type === "presence" && Array.isArray(data.users)) {
        notifyAll(data.users);
      }
    } catch { /* skip */ }
  };

  ws.onclose = () => {
    globalConnected = false;
    globalWs = null;
    // Reconnect with backoff
    if (globalListeners.size > 0) {
      reconnectTimer = setTimeout(() => {
        reconnectDelay = Math.min(reconnectDelay * 1.5, 30_000);
        connectWs(user);
      }, reconnectDelay);
    }
  };

  ws.onerror = () => {
    ws.close();
  };

  // Keep alive ping every 30s
  const keepAlive = setInterval(() => {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ type: "ping" }));
    } else {
      clearInterval(keepAlive);
    }
  }, 30_000);
}

function disconnectWs() {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (globalWs) { globalWs.close(); globalWs = null; }
  globalConnected = false;
  globalUsers = [];
}

/**
 * Fetch initial online users via REST as fallback while WS connects
 */
async function fetchPresenceRest(): Promise<OnlineUser[]> {
  try {
    const wallet = localStorage.getItem("mf_wallet_address") ?? "";
    const res = await fetch(`${BASE}/api/presence`, {
      headers: { "x-wallet-address": wallet },
    });
    if (!res.ok) return [];
    const data = await res.json() as { users?: OnlineUser[] };
    return data.users ?? [];
  } catch {
    return [];
  }
}

export function usePresence() {
  const { user } = useUser();
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>(globalUsers);
  const [isConnected, setIsConnected] = useState(globalConnected);
  const listenerRef = useRef<(users: OnlineUser[]) => void>(() => {});

  // REST-based initial load
  useEffect(() => {
    if (!user) return;
    fetchPresenceRest().then((users) => {
      if (users.length > 0) setOnlineUsers(users);
    });
  }, [user?.id]);

  useEffect(() => {
    if (!user) return;

    const listener = (users: OnlineUser[]) => {
      setOnlineUsers(users);
      setIsConnected(true);
    };
    listenerRef.current = listener;
    globalListeners.add(listener);

    // Connect / reconnect
    connectWs(user);

    // Also set initial state from cache
    if (globalUsers.length > 0) setOnlineUsers(globalUsers);

    return () => {
      globalListeners.delete(listener);
      // Disconnect only when no more listeners
      if (globalListeners.size === 0) {
        disconnectWs();
      }
    };
  }, [user?.id]);

  const isOnline = useCallback(
    (userId: number) => onlineUsers.some((u) => u.userId === userId),
    [onlineUsers]
  );

  return {
    onlineUsers,
    onlineCount: onlineUsers.length,
    isConnected,
    isOnline,
  };
}
