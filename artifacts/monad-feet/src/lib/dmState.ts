export type Conversation = {
  userId: number;
  name: string | null;
  username: string | null;
  avatarUrl: string | null;
  dmRequiresSubscription: boolean;
  isMuted: boolean;
  isBlocked: boolean;
  lastMessage: { content: string; sentByMe: boolean; at: string };
  unreadCount: number;
};

export type Message = {
  id: number;
  content: string;
  sentByMe: boolean;
  readAt: string | null;
  createdAt: string;
};

export type OtherUser = Omit<Conversation, "userId" | "lastMessage" | "unreadCount"> & {
  id: number;
  subscriptionPrice: number | null;
};

export type ThreadData = { otherUser: OtherUser; messages: Message[] };
export type SubGateError = {
  creatorId: number;
  message: string;
  creatorName: string | null;
  subscriptionPrice: number | null;
};

// Each lane owns one request. Switching threads, deleting, sending, or
// unmounting invalidates earlier responses even if abort arrives too late.
export function createDmRequestLane() {
  let controller: AbortController | null = null;
  let pending = false;
  return {
    begin() {
      controller?.abort();
      controller = new AbortController();
      pending = true;
      return controller;
    },
    isCurrent(request: AbortController) {
      return controller === request && !request.signal.aborted;
    },
    isPending() { return pending; },
    finish(request: AbortController) {
      if (controller === request) pending = false;
    },
    invalidate() {
      controller?.abort();
      controller = null;
      pending = false;
    },
  };
}

export function appendDmMessage(thread: ThreadData | null, userId: number, message: Message): ThreadData | null {
  if (!thread || thread.otherUser.id !== userId) return thread;
  const messages = thread.messages.filter((existing) => existing.id !== message.id);
  return { ...thread, messages: [...messages, message].sort((a, b) => a.id - b.id) };
}

export function conversationAfterSend(
  conversations: Conversation[], recipient: OtherUser, message: Message,
): Conversation[] {
  const existing = conversations.find((conversation) => conversation.userId === recipient.id);
  const { id, subscriptionPrice: _price, ...profile } = recipient;
  const updated: Conversation = {
    ...profile, ...existing, userId: id,
    lastMessage: { content: message.content, sentByMe: message.sentByMe, at: message.createdAt },
    unreadCount: existing?.unreadCount ?? 0,
  };
  return [updated, ...conversations.filter((conversation) => conversation.userId !== id)];
}

export function draftAfterSend(current: string, submitted: string) {
  // Never erase text typed while a send was in flight.
  return current === submitted ? "" : current;
}

export function parseDmUserId(search: string): number | null {
  const value = new URLSearchParams(search).get("userId");
  if (!value || !/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

export class DmRequestError extends Error {
  status: number;
  body: Record<string, unknown>;
  constructor(status: number, body: Record<string, unknown>) {
    super(
      typeof body.message === "string" ? body.message
        : typeof body.error === "string" ? body.error
          : `Request failed (HTTP ${status}). Please try again.`,
    );
    this.status = status;
    this.body = body;
  }
}

export async function dmRequest<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { credentials: "include", cache: "no-store", ...init });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    throw new DmRequestError(response.status, body && typeof body === "object" ? body as Record<string, unknown> : {});
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function dmErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to connect. Please try again.";
}

export function dmSubscriptionGate(error: unknown): SubGateError | null {
  if (!(error instanceof DmRequestError) || error.body.error !== "subscription_required"
      || typeof error.body.creatorId !== "number") return null;
  return {
    creatorId: error.body.creatorId,
    message: error.message,
    creatorName: typeof error.body.creatorName === "string" ? error.body.creatorName : null,
    subscriptionPrice: typeof error.body.subscriptionPrice === "number" ? error.body.subscriptionPrice : null,
  };
}