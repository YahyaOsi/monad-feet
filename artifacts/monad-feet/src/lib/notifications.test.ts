import { test } from "node:test";
import assert from "node:assert/strict";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import {
  NOTIFICATION_POLL_INTERVAL, notificationQueryOptions, notificationRequest,
  notificationsQueryKey, writeNotification, type NotificationScope, type NotificationsResponse,
} from "./notifications";
import { getAppNavigation, navBadgeLabel } from "./navigation";

const alice: NotificationScope = { userId: 1, walletAddress: "0xALICE" };
const bob: NotificationScope = { userId: 2, walletAddress: "0xBOB" };
const snapshot = (unreadCount: number, read = false): NotificationsResponse => ({
  notifications: [{
    id: 7, type: "like", title: "Post liked", body: "A user liked your post.",
    createdAt: "2026-01-01T00:00:00Z", read,
  }],
  unreadCount,
  preferences: { likesEnabled: true, subscriptionsEnabled: true, badgesEnabled: true, systemEnabled: true },
});
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "Content-Type": "application/json" },
});
const makeClient = () => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

test("desktop/mobile share the swapped slots, correct routes and exact notification badge", () => {
  for (const count of [0, 1, 12, 137]) {
    const { primaryNav, secondaryNav } = getAppNavigation({ userId: 42, unreadCount: count, dmUnreadCount: 12, onlineCount: 2 });
    assert.equal(primaryNav[3].label, "Notifications");
    assert.equal(primaryNav[3].href, "/notifications");
    assert.equal(primaryNav[3].badge, count);
    assert.equal(navBadgeLabel(primaryNav[3]), String(count));
    assert.equal(secondaryNav[5].label, "Messages");
    assert.equal(secondaryNav[5].href, "/messages");
    assert.equal(secondaryNav[5].badge, 12);
    assert.equal(navBadgeLabel(secondaryNav[5]), "9+");
    assert.equal(primaryNav.filter(item => item.href === "/messages").length, 0);
    assert.equal(secondaryNav.filter(item => item.href === "/notifications").length, 0);
  }
});

test("query keys are user/wallet scoped and refresh configuration covers reload/focus/reconnect", () => {
  assert.notDeepEqual(notificationsQueryKey(alice), notificationsQueryKey(bob));
  assert.notDeepEqual(notificationsQueryKey(alice), notificationsQueryKey({ ...alice, walletAddress: bob.walletAddress }));
  assert.deepEqual(notificationsQueryKey(alice), notificationsQueryKey({ ...alice, walletAddress: "0xalice" }));
  const options = notificationQueryOptions(alice);
  assert.equal(options.staleTime, 0);
  assert.equal(options.refetchOnMount, "always");
  assert.equal(options.refetchOnWindowFocus, "always");
  assert.equal(options.refetchOnReconnect, "always");
  assert.equal(notificationQueryOptions(null).enabled, false);
  assert.equal(NOTIFICATION_POLL_INTERVAL, 30_000);
});

test("shared layout/page queries deduplicate, use total server count, and duplicate events cannot inflate it", async t => {
  const client = makeClient();
  let count = 60;
  let requests = 0;
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    requests++;
    assert.equal(init.credentials, "include");
    assert.equal(init.cache, "no-store");
    assert.equal((init.headers as Record<string, string>)["x-wallet-address"], alice.walletAddress);
    return response(snapshot(count));
  });
  try {
    const options = notificationQueryOptions(alice);
    await Promise.all([client.fetchQuery(options), client.fetchQuery(options)]);
    assert.equal(requests, 1);
    assert.equal(client.getQueryData<NotificationsResponse>(options.queryKey)?.unreadCount, 60);
    count = 61; // Another user creates one notification.
    await client.fetchQuery(options);
    await client.fetchQuery(options); // Duplicate realtime delivery/poll.
    assert.equal(client.getQueryData<NotificationsResponse>(options.queryKey)?.unreadCount, 61);
  } finally {
    client.clear();
  }
});

test("successful reads update all observers from server state, are idempotent and read-all preserves a newly arrived unread", async t => {
  const client = makeClient();
  let state = snapshot(60);
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    if (init.method === "POST" && url.endsWith("/7/read")) {
      if (!state.notifications[0].read) state = snapshot(state.unreadCount - 1, true);
      return response({ success: true });
    }
    if (init.method === "POST" && url.endsWith("/read-all")) {
      // A new notification arrives just after read-all commits.
      state = snapshot(1, true);
      return response({ success: true });
    }
    return response(state);
  });
  const options = notificationQueryOptions(alice);
  const observer = new QueryObserver(client, options);
  const unsubscribe = observer.subscribe(() => {});
  try {
    await client.fetchQuery(options);
    await writeNotification(client, { scope: alice, path: "/7/read", method: "POST" });
    assert.equal(observer.getCurrentResult().data?.unreadCount, 59);
    assert.equal(observer.getCurrentResult().data?.notifications[0].read, true);
    await writeNotification(client, { scope: alice, path: "/7/read", method: "POST" });
    assert.equal(observer.getCurrentResult().data?.unreadCount, 59);
    await writeNotification(client, { scope: alice, path: "/read-all", method: "POST" });
    assert.equal(observer.getCurrentResult().data?.unreadCount, 1);
    state = snapshot(0, true);
    await client.fetchQuery(options);
    assert.equal(observer.getCurrentResult().data?.unreadCount, 0);
  } finally {
    unsubscribe();
    client.clear();
  }
});

test("failed reads and failed refreshes expose errors without fabricating read state or zero counts", async t => {
  const client = makeClient();
  let fail = false;
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    if (init.method === "POST") return response({ error: "Unable to save read state" }, 503);
    return fail ? response({ error: "Notifications unavailable" }, 503) : response(snapshot(3));
  });
  const options = notificationQueryOptions(alice);
  try {
    await client.fetchQuery(options);
    await assert.rejects(writeNotification(client, { scope: alice, path: "/7/read", method: "POST" }), /Unable to save read state/);
    assert.equal(client.getQueryData<NotificationsResponse>(options.queryKey)?.unreadCount, 3);
    assert.equal(client.getQueryData<NotificationsResponse>(options.queryKey)?.notifications[0].read, false);
    fail = true;
    await assert.rejects(client.fetchQuery(options), /Notifications unavailable/);
    assert.equal(client.getQueryData<NotificationsResponse>(options.queryKey)?.unreadCount, 3);
  } finally {
    client.clear();
  }
});

test("a slow pre-read poll is cancelled and cannot restore the previous unread count", async t => {
  const client = makeClient();
  let reads = 0;
  let resolveOld!: (result: Response) => void;
  let oldSignal: AbortSignal | null | undefined;
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    if (init.method === "POST") return response({ success: true });
    reads++;
    if (reads === 2) {
      oldSignal = init.signal;
      return new Promise<Response>(resolve => { resolveOld = resolve; });
    }
    return response(reads === 1 ? snapshot(3) : snapshot(2, true));
  });
  const options = notificationQueryOptions(alice);
  const observer = new QueryObserver(client, options);
  const unsubscribe = observer.subscribe(() => {});
  try {
    await client.fetchQuery(options);
    const oldPoll = client.fetchQuery(options);
    // TanStack may resolve a cancelled refetch with its restored cached data.
    const cancelled = oldPoll.catch(() => undefined);
    await writeNotification(client, { scope: alice, path: "/7/read", method: "POST" });
    await cancelled;
    assert.equal(oldSignal?.aborted, true);
    resolveOld(response(snapshot(3)));
    await Promise.resolve();
    assert.equal(observer.getCurrentResult().data?.unreadCount, 2);
    assert.equal(observer.getCurrentResult().data?.notifications[0].read, true);
  } finally {
    unsubscribe();
    client.clear();
  }
});

test("preference changes rehydrate the badge/list and persist when navigating or using a fresh cache", async t => {
  const client = makeClient();
  const reloaded = makeClient();
  let state = snapshot(3);
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    if (init.method === "PUT") {
      assert.deepEqual(JSON.parse(init.body as string), { likesEnabled: false });
      state = { ...state, notifications: [], unreadCount: 0, preferences: { ...state.preferences, likesEnabled: false } };
      return response(state.preferences);
    }
    return response(state);
  });
  const options = notificationQueryOptions(alice);
  const observer = new QueryObserver(client, options);
  const unsubscribe = observer.subscribe(() => {});
  try {
    await client.fetchQuery(options);
    await writeNotification(client, {
      scope: alice, path: "/preferences", method: "PUT", data: { likesEnabled: false },
    });
    assert.equal(observer.getCurrentResult().data?.unreadCount, 0);
    assert.equal(observer.getCurrentResult().data?.preferences.likesEnabled, false);
    assert.equal((await client.fetchQuery(options)).unreadCount, 0);
    assert.equal((await reloaded.fetchQuery(options)).preferences.likesEnabled, false);
  } finally {
    unsubscribe();
    client.clear();
    reloaded.clear();
  }
});

test("account switches abort previous snapshots and old mutations never invalidate another user's cache", async t => {
  const client = makeClient();
  let resolveAlice!: (result: Response) => void;
  let oldSignal: AbortSignal | null | undefined;
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    if (init.method === "POST") return response({ success: true });
    const wallet = (init.headers as Record<string, string>)["x-wallet-address"];
    if (wallet === alice.walletAddress) {
      oldSignal = init.signal;
      return new Promise<Response>(resolve => { resolveAlice = resolve; });
    }
    return response(snapshot(2));
  });
  try {
    const aliceOptions = notificationQueryOptions(alice);
    const pending = client.fetchQuery(aliceOptions);
    const rejected = assert.rejects(pending);
    await client.cancelQueries({ queryKey: aliceOptions.queryKey, exact: true });
    client.removeQueries({ queryKey: aliceOptions.queryKey, exact: true });
    await rejected;
    assert.equal(oldSignal?.aborted, true);
    await client.fetchQuery(notificationQueryOptions(bob));
    resolveAlice(response(snapshot(99)));
    await writeNotification(client, { scope: alice, path: "/7/read", method: "POST" });
    assert.equal(client.getQueryData<NotificationsResponse>(notificationsQueryKey(bob))?.unreadCount, 2);
    assert.equal(client.getQueryState(notificationsQueryKey(bob))?.isInvalidated, false);
    assert.equal(client.getQueryData(notificationsQueryKey(alice)), undefined);
    assert.equal(client.getQueryData(notificationsQueryKey(null)), undefined);
  } finally {
    client.clear();
  }
});

test("invalid notification payloads and HTTP errors are explicit, not empty success", async t => {
  t.mock.method(globalThis, "fetch", async () => response({ error: "Sign in required" }, 401));
  await assert.rejects(notificationRequest(alice, ""), /Sign in required/);
  t.mock.method(globalThis, "fetch", async () => response({ unreadCount: -1, notifications: [] }));
  await assert.rejects(notificationQueryOptions(alice).queryFn({ signal: new AbortController().signal }), /invalid notification response/);
});