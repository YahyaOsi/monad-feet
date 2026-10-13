import type { QueryClient } from "@tanstack/react-query";

export type NotificationType = "like" | "subscription" | "badge" | "system";

export interface NotificationItem {
  id: number;
  type: NotificationType;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
  actorName?: string | null;
  actorAvatarUrl?: string | null;
  actorUsername?: string | null;
  actorId?: number | null;
  resourceType?: string | null;
  resourceId?: number | string | null;
}

export interface NotificationPreferences {
  likesEnabled: boolean;
  subscriptionsEnabled: boolean;
  badgesEnabled: boolean;
  systemEnabled: boolean;
}

export interface NotificationsResponse {
  notifications: NotificationItem[];
  unreadCount: number;
  preferences: NotificationPreferences;
}

export interface NotificationScope {
  userId: number;
  walletAddress: string;
}

// WebSocket events still refresh immediately; polling is a fallback.
export const NOTIFICATION_POLL_INTERVAL = 30_000;

export function notificationsQueryKey(scope: NotificationScope | null) {
  return ["notifications", scope?.userId ?? null, scope?.walletAddress.toLowerCase() ?? null] as const;
}

export async function notificationRequest<T>(
  scope: NotificationScope,
  path: string,
  init: RequestInit = {},
  base = "",
): Promise<T> {
  const response = await fetch(`${base}/api/notifications${path}`, {
    ...init,
    credentials: "include",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "x-wallet-address": scope.walletAddress,
      ...init.headers,
    },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(typeof body?.error === "string" ? body.error : `Notification request failed (${response.status})`);
  }
  if (body === null) throw new Error("The server returned an invalid notification response.");
  return body as T;
}

export function notificationQueryOptions(scope: NotificationScope | null, base = "") {
  return {
    queryKey: notificationsQueryKey(scope),
    enabled: scope !== null,
    queryFn: async ({ signal }: { signal: AbortSignal }): Promise<NotificationsResponse> => {
      if (!scope) throw new Error("Sign in to view notifications.");
      const data = await notificationRequest<NotificationsResponse>(scope, "", { signal }, base);
      if (!Array.isArray(data.notifications) || !Number.isSafeInteger(data.unreadCount) || data.unreadCount < 0 || !data.preferences) {
        throw new Error("The server returned an invalid notification response.");
      }
      return data;
    },
    staleTime: 0,
    refetchOnMount: "always" as const,
    refetchOnWindowFocus: "always" as const,
    refetchOnReconnect: "always" as const,
  };
}

export interface NotificationWrite {
  scope: NotificationScope;
  path: string;
  method: "POST" | "PUT";
  data?: Partial<NotificationPreferences>;
}

// Reads and realtime events never increment/decrement a local counter. Cancel
// pre-write snapshots, then rehydrate the same user-scoped authoritative query.
export async function writeNotification(
  client: QueryClient,
  write: NotificationWrite,
  base = "",
): Promise<void> {
  const queryKey = notificationsQueryKey(write.scope);
  await client.cancelQueries({ queryKey, exact: true });
  await notificationRequest(write.scope, write.path, {
    method: write.method,
    ...(write.data ? { body: JSON.stringify(write.data) } : {}),
  }, base);
  await client.invalidateQueries({ queryKey, exact: true });
}