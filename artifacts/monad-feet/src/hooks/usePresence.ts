import { useState, useEffect, useCallback } from "react";
import { useUser } from "@/context/UserContext";
import { uniqueMembers } from "@/lib/presenceMembers";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export type OnlineUser = {
  userId: number;
  walletAddress: string;
  name: string | null;
  username: string | null;
  avatarUrl: string | null;
  connectedAt: string;
};

export type ActivityEvent =
  | { type: "post_created"; post: LivePost; actorId: number }
  | { type: "post_liked"; postId: number; likeCount: number; actorId: number }
  | { type: "post_anchored"; postId: number; txHash: string }
  | { type: "trending_alert"; postId: number; rank: number; postContent: string | null }
  | { type: "badge_earned"; userId: number; badge: BadgeInfo }
  | { type: "new_dm"; messageId: number; senderId: number; senderName: string | null; senderAvatarUrl: string | null; preview: string }
  | { type: "new_subscription"; subscriberId: number; subscriberName: string | null; subscriberUsername: string | null; subscriberAvatarUrl: string | null; isRenewal: boolean }
  | { type: "invite_codes_earned"; userId: number; codes: number; reason: string };

export type BadgeInfo = {
  badgeType: string;
  label: string;
  description: string;
  emoji: string;
};

export type LivePost = {
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

export type TrendingAlert = {
  postId: number;
  rank: number;
  postContent: string | null;
  seenAt: number;
};

export type SubscriptionAlert = {
  subscriberId: number;
  subscriberName: string | null;
  subscriberUsername: string | null;
  subscriberAvatarUrl: string | null;
  isRenewal: boolean;
  seenAt: number;
};

export type BadgeAlert = {
  badge: BadgeInfo;
  seenAt: number;
};

// ── Global WS singleton ──────────────────────────────────────────
let globalWs: WebSocket | null = null;
let globalConnected = false;
let globalUserId: number | null = null;
let keepAliveTimer: ReturnType<typeof setInterval> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 1_000;

type PresenceListener = (users: OnlineUser[]) => void;
type ActivityListener = (event: ActivityEvent) => void;

let globalUsers: OnlineUser[] = [];
let presenceGeneration = 0;
const presenceListeners = new Set<PresenceListener>();
const activityListeners = new Set<ActivityListener>();
const connectionListeners = new Set<(connected: boolean) => void>();

function notifyConnection(connected: boolean) {
  globalConnected = connected;
  for (const fn of connectionListeners) fn(connected);
}

function notifyPresence(users: OnlineUser[]) {
  presenceGeneration++;
  globalUsers = uniqueMembers(users);
  for (const fn of presenceListeners) fn(globalUsers);
}

function notifyActivity(event: ActivityEvent) {
  for (const fn of activityListeners) fn(event);
}

function connectWs(user: {
  id: number;
  walletAddress: string;
  name?: string | null;
  username?: string | null;
  avatarUrl?: string | null;
}) {
  if (globalWs && globalWs.readyState <= 1 && globalUserId === user.id) return;
  disconnectWs();
  globalUserId = user.id;

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
    if (globalWs !== ws) return;
    notifyConnection(true);
    reconnectDelay = 1_000;
  };

  ws.onmessage = (event) => {
    if (globalWs !== ws) return;
    try {
      const data = JSON.parse(String(event.data)) as {
        type: string;
        users?: OnlineUser[];
        event?: ActivityEvent;
      };

      if (data.type === "presence" && Array.isArray(data.users)) {
        notifyPresence(data.users);
      } else if (data.type === "activity" && data.event) {
        notifyActivity(data.event);
      }
    } catch { /* skip */ }
  };

  ws.onclose = () => {
    // A retired socket must not reset its replacement or create another one.
    if (globalWs !== ws) return;
    notifyConnection(false);
    notifyPresence([]);
    globalWs = null;
    if (keepAliveTimer) { clearInterval(keepAliveTimer); keepAliveTimer = null; }
    const hasListeners = presenceListeners.size > 0 || activityListeners.size > 0;
    if (hasListeners) {
      reconnectTimer = setTimeout(() => {
        reconnectDelay = Math.min(reconnectDelay * 1.5, 30_000);
        connectWs(user);
      }, reconnectDelay);
    }
  };

  ws.onerror = () => ws.close();

  keepAliveTimer = setInterval(() => {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ type: "ping" }));
    } else {
      if (keepAliveTimer) { clearInterval(keepAliveTimer); keepAliveTimer = null; }
    }
  }, 30_000);
}

function disconnectWs() {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (keepAliveTimer) { clearInterval(keepAliveTimer); keepAliveTimer = null; }
  const retired = globalWs;
  globalWs = null;
  globalUserId = null;
  retired?.close();
  notifyConnection(false);
  notifyPresence([]);
}

async function fetchPresenceRest(): Promise<OnlineUser[]> {
  try {
    const wallet = localStorage.getItem("mf_wallet_address") ?? "";
    const res = await fetch(`${BASE}/api/presence`, { headers: { "x-wallet-address": wallet } });
    if (!res.ok) return [];
    const data = await res.json() as { users?: OnlineUser[] };
    return uniqueMembers(data.users ?? []);
  } catch { return []; }
}

// ── usePresence ──────────────────────────────────────────────────
export function usePresence() {
  const { user } = useUser();
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>(globalUsers);
  const [isConnected, setIsConnected] = useState(globalConnected);
  const [wsEvent, setWsEvent] = useState<ActivityEvent | null>(null);

  useEffect(() => {
    let active = true;
    if (!user) {
      setOnlineUsers([]);
      setIsConnected(false);
      return;
    }
    const presenceListener: PresenceListener = (users) => {
      setOnlineUsers(users);
    };
    const activityListener: ActivityListener = (event) => {
      setWsEvent(event);
    };
    presenceListeners.add(presenceListener);
    activityListeners.add(activityListener);
    connectionListeners.add(setIsConnected);
    connectWs(user);
    setOnlineUsers(globalUsers);
    setIsConnected(globalConnected);
    const generation = presenceGeneration;
    fetchPresenceRest().then(users => {
      // Never let a delayed REST response replace a newer socket snapshot,
      // including an empty snapshot from a disconnected or replaced socket.
      if (active && !globalConnected && generation === presenceGeneration) setOnlineUsers(users);
    });
    return () => {
      active = false;
      presenceListeners.delete(presenceListener);
      activityListeners.delete(activityListener);
      connectionListeners.delete(setIsConnected);
      if (presenceListeners.size === 0 && activityListeners.size === 0) disconnectWs();
    };
  }, [user?.id]);

  const isOnline = useCallback(
    (userId: number) => onlineUsers.some((u) => u.userId === userId),
    [onlineUsers],
  );

  return { onlineUsers, onlineCount: onlineUsers.length, isConnected, isOnline, wsEvent };
}

// ── useActivityFeed ──────────────────────────────────────────────
export function useActivityFeed(currentUserId: number | undefined) {
  const { user } = useUser();
  const [pendingPosts, setPendingPosts] = useState<LivePost[]>([]);
  const [likeUpdates, setLikeUpdates] = useState<Map<number, number>>(new Map());
  const [anchorUpdates, setAnchorUpdates] = useState<Map<number, string>>(new Map());

  useEffect(() => {
    if (!user) return;
    const listener: ActivityListener = (event) => {
      if (event.type === "post_created") {
        if (event.actorId === currentUserId) return;
        setPendingPosts((prev) => [event.post, ...prev]);
      } else if (event.type === "post_liked") {
        setLikeUpdates((prev) => new Map(prev).set(event.postId, event.likeCount));
      } else if (event.type === "post_anchored") {
        setAnchorUpdates((prev) => new Map(prev).set(event.postId, event.txHash));
      }
    };
    activityListeners.add(listener);
    connectWs(user);
    return () => {
      activityListeners.delete(listener);
      if (presenceListeners.size === 0 && activityListeners.size === 0) disconnectWs();
    };
  }, [user?.id, currentUserId]);

  const flushPending = useCallback((): LivePost[] => {
    const flushed = pendingPosts;
    setPendingPosts([]);
    return flushed;
  }, [pendingPosts]);

  return { pendingCount: pendingPosts.length, flushPending, likeUpdates, anchorUpdates };
}

// ── useTrendingAlert ─────────────────────────────────────────────
export function useTrendingAlert() {
  const { user } = useUser();
  const [alert, setAlert] = useState<TrendingAlert | null>(null);

  useEffect(() => {
    if (!user) return;
    const listener: ActivityListener = (event) => {
      if (event.type === "trending_alert") {
        setAlert({ postId: event.postId, rank: event.rank, postContent: event.postContent, seenAt: Date.now() });
      }
    };
    activityListeners.add(listener);
    connectWs(user);
    return () => {
      activityListeners.delete(listener);
      if (presenceListeners.size === 0 && activityListeners.size === 0) disconnectWs();
    };
  }, [user?.id]);

  const dismiss = useCallback(() => setAlert(null), []);
  return { alert, dismiss };
}

// ── useSubscriptionAlert ─────────────────────────────────────────
export function useSubscriptionAlert() {
  const { user } = useUser();
  const [alert, setAlert] = useState<SubscriptionAlert | null>(null);

  useEffect(() => {
    if (!user) return;
    const listener: ActivityListener = (event) => {
      if (event.type === "new_subscription") {
        setAlert({
          subscriberId: event.subscriberId,
          subscriberName: event.subscriberName,
          subscriberUsername: event.subscriberUsername,
          subscriberAvatarUrl: event.subscriberAvatarUrl,
          isRenewal: event.isRenewal,
          seenAt: Date.now(),
        });
      }
    };
    activityListeners.add(listener);
    connectWs(user);
    return () => {
      activityListeners.delete(listener);
      if (presenceListeners.size === 0 && activityListeners.size === 0) disconnectWs();
    };
  }, [user?.id]);

  const dismiss = useCallback(() => setAlert(null), []);
  return { alert, dismiss };
}

// ── useInviteCodeAlert ───────────────────────────────────────────
export function useInviteCodeAlert(onEarned: (codes: number, reason: string) => void) {
  const { user } = useUser();

  useEffect(() => {
    if (!user) return;
    const listener: ActivityListener = (event) => {
      if (event.type === "invite_codes_earned" && event.userId === user.id) {
        onEarned(event.codes, event.reason);
      }
    };
    activityListeners.add(listener);
    connectWs(user);
    return () => {
      activityListeners.delete(listener);
      if (presenceListeners.size === 0 && activityListeners.size === 0) disconnectWs();
    };
  }, [user?.id, onEarned]);
}

// ── useBadgeAlert ────────────────────────────────────────────────
export function useBadgeAlert() {
  const { user } = useUser();
  const [alert, setAlert] = useState<BadgeAlert | null>(null);

  useEffect(() => {
    if (!user) return;
    const listener: ActivityListener = (event) => {
      if (event.type === "badge_earned" && event.userId === user.id) {
        setAlert({ badge: event.badge, seenAt: Date.now() });
      }
    };
    activityListeners.add(listener);
    connectWs(user);
    return () => {
      activityListeners.delete(listener);
      if (presenceListeners.size === 0 && activityListeners.size === 0) disconnectWs();
    };
  }, [user?.id]);

  const dismiss = useCallback(() => setAlert(null), []);
  return { alert, dismiss };
}
