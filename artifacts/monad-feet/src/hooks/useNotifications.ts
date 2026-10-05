import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useUser } from "@/context/UserContext";
import type { ActivityEvent } from "@/hooks/usePresence";
import {
  NOTIFICATION_POLL_INTERVAL, notificationQueryOptions, notificationsQueryKey,
  writeNotification, type NotificationPreferences, type NotificationScope,
} from "@/lib/notifications";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// The layout owns the single polling observer; the page observes the same cache.
// These endpoints do not yet have generated API hooks.
export function useNotifications({
  live = false,
  activityEvent,
}: { live?: boolean; activityEvent?: ActivityEvent | null } = {}) {
  const { user } = useUser();
  const client = useQueryClient();
  const scope: NotificationScope | null = user
    ? { userId: user.id, walletAddress: user.walletAddress.toLowerCase() }
    : null;
  const query = useQuery({
    ...notificationQueryOptions(scope, BASE),
    refetchInterval: live && scope ? NOTIFICATION_POLL_INTERVAL : false,
    refetchIntervalInBackground: false,
  });
  const mutation = useMutation({
    mutationFn: (write: Parameters<typeof writeNotification>[1]) => writeNotification(client, write, BASE),
  });
  const userId = scope?.userId;
  const walletAddress = scope?.walletAddress;

  useEffect(() => {
    if (!live || userId === undefined || !walletAddress || !activityEvent) return;
    if (activityEvent.type === "post_created" || activityEvent.type === "post_anchored") return;
    // Existing like/DM/subscription/badge events are refresh hints, never count
    // deltas. Polling also covers comments/digests and missed/offline events.
    void client.invalidateQueries({
      queryKey: notificationsQueryKey({ userId, walletAddress }),
      exact: true,
    }, { cancelRefetch: false });
  }, [live, activityEvent, userId, walletAddress, client]);

  useEffect(() => {
    if (!live || userId === undefined || !walletAddress) return;
    const refresh = () => {
      if (document.visibilityState === "hidden") return;
      void client.invalidateQueries({
        queryKey: notificationsQueryKey({ userId, walletAddress }),
        exact: true,
      });
    };
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [live, userId, walletAddress, client]);

  const belongsToCurrentUser = mutation.variables?.scope.userId === userId
    && mutation.variables?.scope.walletAddress === walletAddress;
  const write = (path: string, method: "POST" | "PUT", data?: Partial<NotificationPreferences>) => {
    if (!scope) return Promise.reject(new Error("Sign in to update notifications."));
    return mutation.mutateAsync({ scope, path, method, data });
  };

  return {
    ...query,
    data: scope ? query.data : undefined,
    unreadCount: scope ? query.data?.unreadCount ?? 0 : 0,
    isSaving: belongsToCurrentUser && mutation.isPending,
    writeError: belongsToCurrentUser ? mutation.error : null,
    markRead: (id: number) => write(`/${id}/read`, "POST"),
    markAllRead: () => write("/read-all", "POST"),
    updatePreferences: (data: Partial<NotificationPreferences>) => write("/preferences", "PUT", data),
  };
}