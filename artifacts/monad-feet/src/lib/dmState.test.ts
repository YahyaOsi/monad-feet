import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appendDmMessage, conversationAfterSend, createDmRequestLane, dmRequest,
  dmSubscriptionGate, DmRequestError, draftAfterSend, parseDmUserId,
  type Conversation, type Message, type OtherUser, type ThreadData,
} from "./dmState.ts";

const recipient: OtherUser = {
  id: 12, name: "Recipient", username: "recipient", avatarUrl: null,
  isBlocked: false, isMuted: false, dmRequiresSubscription: false, subscriptionPrice: null,
};
const sent: Message = { id: 50, content: "Sent message", sentByMe: true, readAt: null, createdAt: "2026-01-01T12:00:00Z" };
const received: Message = { ...sent, id: 49, content: "Received message", sentByMe: false };
const thread: ThreadData = { otherUser: recipient, messages: [received] };
const conversation: Conversation = {
  userId: recipient.id, name: recipient.name, username: recipient.username, avatarUrl: null,
  isBlocked: false, isMuted: true, dmRequiresSubscription: false, unreadCount: 2,
  lastMessage: { content: received.content, sentByMe: false, at: received.createdAt },
};

test("late thread responses cannot replace the currently selected user's thread", async () => {
  const lane = createDmRequestLane();
  const oldRequest = lane.begin();
  let resolveOld!: (value: ThreadData) => void;
  const delayed = new Promise<ThreadData>((resolve) => { resolveOld = resolve; });
  const newRequest = lane.begin();
  const currentThread = { ...thread, otherUser: { ...recipient, id: 13 } };
  let visible = currentThread;
  const pending = delayed.then((data) => { if (lane.isCurrent(oldRequest)) visible = data; });
  resolveOld(thread);
  await pending;
  assert.equal(oldRequest.signal.aborted, true);
  assert.equal(lane.isCurrent(newRequest), true);
  assert.equal(visible.otherUser.id, 13);
});

test("deletion, a successful send, and unmount can invalidate in-flight list snapshots", () => {
  const lane = createDmRequestLane();
  const oldRequest = lane.begin();
  lane.invalidate();
  assert.equal(lane.isCurrent(oldRequest), false);
  assert.equal(oldRequest.signal.aborted, true);
  const newRequest = lane.begin();
  assert.equal(lane.isCurrent(newRequest), true);
});

test("polling can leave a slow request alone, and a stale completion cannot finish its successor", () => {
  const lane = createDmRequestLane();
  const oldRequest = lane.begin();
  assert.equal(lane.isPending(), true);
  const newRequest = lane.begin();
  lane.finish(oldRequest);
  assert.equal(lane.isPending(), true);
  lane.finish(newRequest);
  assert.equal(lane.isPending(), false);
  lane.begin();
  lane.invalidate();
  assert.equal(lane.isPending(), false);
});

test("successful send appends once and never adds a message to another recipient's thread", () => {
  const updated = appendDmMessage(thread, recipient.id, sent)!;
  assert.deepEqual(updated.messages, [received, sent]);
  assert.deepEqual(appendDmMessage(updated, recipient.id, sent)?.messages, [received, sent]);
  assert.equal(appendDmMessage(thread, 13, sent), thread);
  assert.equal(appendDmMessage(null, recipient.id, sent), null);
});

test("successful send immediately creates/reorders the correct conversation without clearing others' unread", () => {
  const other = { ...conversation, userId: 13, unreadCount: 7 };
  const updated = conversationAfterSend([other, conversation], recipient, sent);
  assert.deepEqual(updated.map((item) => item.userId), [12, 13]);
  assert.equal(updated[0].lastMessage.content, sent.content);
  assert.equal(updated[0].lastMessage.sentByMe, true);
  assert.equal(updated[0].isMuted, true);
  assert.equal(updated[1], other);
  const created = conversationAfterSend([other], recipient, sent);
  assert.equal(created[0].userId, recipient.id);
  assert.equal(created[0].unreadCount, 0);
});

test("a send clears only its exact submitted draft, not text typed while waiting", () => {
  assert.equal(draftAfterSend("hello", "hello"), "");
  assert.equal(draftAfterSend("hello again", "hello"), "hello again");
  assert.equal(draftAfterSend("different conversation draft", "hello"), "different conversation draft");
});

test("mobile direct links accept only a positive, safe user ID", () => {
  assert.equal(parseDmUserId("?userId=12"), 12);
  for (const value of ["", "?userId=0", "?userId=-1", "?userId=12oops", "?userId=1.5", "?userId=999999999999999999999"]) {
    assert.equal(parseDmUserId(value), null);
  }
});

test("blocked and generic forbidden errors are not mistaken for a paid DM gate", () => {
  assert.equal(dmSubscriptionGate(new DmRequestError(403, { error: "blocked", message: "Cannot send messages." })), null);
  assert.equal(dmSubscriptionGate(new DmRequestError(403, { error: "Forbidden" })), null);
  assert.deepEqual(dmSubscriptionGate(new DmRequestError(403, {
    error: "subscription_required", creatorId: 12, message: "Subscribe first.", subscriptionPrice: 3,
  })), { creatorId: 12, creatorName: null, message: "Subscribe first.", subscriptionPrice: 3 });
});

test("failed HTTP/network requests reject explicitly instead of returning an empty successful inbox", async (context) => {
  const fetchMock = context.mock.method(globalThis, "fetch", async () => new Response(
    JSON.stringify({ error: "Conversation database unavailable" }), { status: 503 },
  ));
  await assert.rejects(dmRequest("/api/dm/conversations"), /Conversation database unavailable/);
  fetchMock.mock.mockImplementation(async () => new Response("<html>Server failed</html>", { status: 500 }));
  await assert.rejects(dmRequest("/api/dm/conversations"), /HTTP 500/);
  fetchMock.mock.mockImplementation(async () => { throw new Error("Network unavailable"); });
  await assert.rejects(dmRequest("/api/dm/conversations"), /Network unavailable/);
});

test("authenticated requests use credentials/no-store and preserve the DELETE hide endpoint", async (context) => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  context.mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(null, { status: 204 });
  });
  await dmRequest("/api/dm/conversations/12", { method: "DELETE", headers: { "x-wallet-address": "test-wallet" } });
  assert.equal(calls[0].url, "/api/dm/conversations/12");
  assert.equal(calls[0].init?.method, "DELETE");
  assert.equal(calls[0].init?.credentials, "include");
  assert.equal(calls[0].init?.cache, "no-store");
});