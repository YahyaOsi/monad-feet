import { useState, useEffect, useCallback } from "react";
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
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 1_000;

type PresenceListener = (users: OnlineUser[]) => void;
type ActivityListener = (event: ActivityEvent) => void;

let globalUsers: OnlineUser[] = [];
const presenceListeners = new Set<PresenceListener>();
const activityListeners = new Set<ActivityListener>();

function notifyPresence(users: OnlineUser[]) {
  globalUsers = users;
  for (const fn of presenceListeners) fn(users);
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
  if (globalWs && globalWs.readyState <= 1) return;

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
    reconnectDelay = 1_000;
  };

  ws.onmessage = (event) => {
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
    globalConnected = false;
    globalWs = null;
    const hasListeners = presenceListeners.size > 0 || activityListeners.size > 0;
    if (hasListeners) {
      reconnectTimer = setTimeout(() => {
        reconnectDelay = Math.min(reconnectDelay * 1.5, 30_000);
        connectWs(user);
      }, reconnectDelay);
    }
  };

  ws.onerror = () => ws.close();

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

async function fetchPresenceRest(): Promise<OnlineUser[]> {
  try {
    const wallet = localStorage.getItem("mf_wallet_address") ?? "";
    const res = await fetch(`${BASE}/api/presence`, { headers: { "x-wallet-address": wallet } });
    if (!res.ok) return [];
    const data = await res.json() as { users?: OnlineUser[] };
    return data.users ?? [];
  } catch { return []; }
}

// ── usePresence ──────────────────────────────────────────────────
export function usePresence() {
  const { user } = useUser();
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>(globalUsers);
  const [isConnected, setIsConnected] = useState(globalConnected);
  const [wsEvent, setWsEvent] = useState<ActivityEvent | null>(null);

  useEffect(() => {
    if (!user) return;
    fetchPresenceRest().then((u) => { if (u.length > 0) setOnlineUsers(u); });
  }, [user?.id]);

  useEffect(() => {
    if (!user) return;
    const presenceListener: PresenceListener = (users) => {
      setOnlineUsers(users);
      setIsConnected(true);
    };
    const activityListener: ActivityListener = (event) => {
      setWsEvent(event);
    };
    presenceListeners.add(presenceListener);
    activityListeners.add(activityListener);
    connectWs(user);
    if (globalUsers.length > 0) setOnlineUsers(globalUsers);
    return () => {
      presenceListeners.delete(presenceListener);
      activityListeners.delete(activityListener);
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
