import { useCallback, useEffect, useRef, useState } from "react";
import {
  appendDmMessage, conversationAfterSend, createDmRequestLane, dmErrorMessage,
  dmRequest, dmSubscriptionGate, draftAfterSend,
  type Conversation, type Message, type SubGateError, type ThreadData,
} from "@/lib/dmState";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const notifyUnreadChanged = () => window.dispatchEvent(new Event("dm-unread-changed"));

export function useDmInbox(wallet: string, initialUserId: number | null, isConnected: boolean, wsEvent: unknown) {
  const [activeUserId, setActiveUserId] = useState(initialUserId);
  const activeRef = useRef(activeUserId);
  activeRef.current = activeUserId;
  const alive = useRef(true);
  const listLane = useRef(createDmRequestLane());
  const threadLane = useRef(createDmRequestLane());
  const lastReadUserId = useRef<number | null>(null);
  const mutations = useRef(new Set<AbortController>());
  const sendingRef = useRef(false);
  const deletingRef = useRef(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [thread, setThread] = useState<ThreadData | null>(null);
  const [subGate, setSubGate] = useState<SubGateError | null>(null);
  const [loadingConvs, setLoadingConvs] = useState(true);
  const [loadingThread, setLoadingThread] = useState(!!initialUserId);
  const [conversationsError, setConversationsError] = useState<string | null>(null);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [sendErrors, setSendErrors] = useState<Record<number, string | null>>({});
  const [sending, setSending] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ userId: number; name: string | null } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const headers = useCallback(() => ({
    "x-wallet-address": wallet, "Content-Type": "application/json",
  }), [wallet]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      listLane.current.invalidate();
      threadLane.current.invalidate();
      for (const controller of mutations.current) controller.abort();
    };
  }, []);

  const loadConversations = useCallback(async () => {
    if (!alive.current) return;
    const request = listLane.current.begin();
    try {
      const data = await dmRequest<Conversation[]>(`${BASE}/api/dm/conversations`, {
        headers: headers(), signal: request.signal,
      });
      if (!Array.isArray(data)) throw new Error("The server returned an invalid conversations list.");
      if (!alive.current || !listLane.current.isCurrent(request)) return;
      setConversations(data);
      setConversationsError(null);
    } catch (error) {
      if (alive.current && listLane.current.isCurrent(request)) setConversationsError(dmErrorMessage(error));
    } finally {
      if (alive.current && listLane.current.isCurrent(request)) setLoadingConvs(false);
      listLane.current.finish(request);
    }
  }, [headers]);

  const loadThread = useCallback(async () => {
    const userId = activeRef.current;
    if (!userId || !alive.current) return;
    const request = threadLane.current.begin();
    const current = () => alive.current && activeRef.current === userId && threadLane.current.isCurrent(request);
    try {
      const data = await dmRequest<ThreadData>(`${BASE}/api/dm/${userId}`, {
        headers: headers(), signal: request.signal,
      });
      if (data.otherUser?.id !== userId || !Array.isArray(data.messages)) {
        throw new Error("The server returned an invalid conversation.");
      }
      if (!current()) return;
      setThread(data);
      setSubGate(null);
      setThreadError(null);
      // The thread endpoint marks only this conversation read; merely opening
      // the list must never clear other conversations' unread counts.
      if (!data.otherUser.isBlocked) {
        const refreshUnread = lastReadUserId.current !== userId
          || data.messages.some((message) => !message.sentByMe && !message.readAt);
        lastReadUserId.current = userId;
        setConversations((prev) => prev.map((conv) => conv.userId === userId ? { ...conv, unreadCount: 0 } : conv));
        notifyUnreadChanged();
        if (refreshUnread) void loadConversations();
      }
    } catch (error) {
      if (!current()) return;
      const gate = dmSubscriptionGate(error);
      setSubGate(gate);
      setThreadError(gate ? null : dmErrorMessage(error));
    } finally {
      if (current()) setLoadingThread(false);
      threadLane.current.finish(request);
    }
  }, [headers, loadConversations]);

  useEffect(() => { void loadConversations(); }, [loadConversations]);
  useEffect(() => {
    threadLane.current.invalidate();
    lastReadUserId.current = null;
    setThread(null);
    setSubGate(null);
    setThreadError(null);
    setLoadingThread(!!activeUserId);
    if (activeUserId) void loadThread();
    return () => threadLane.current.invalidate();
  }, [activeUserId, loadThread]);

  const refresh = useCallback(() => {
    void loadConversations();
    void loadThread();
  }, [loadConversations, loadThread]);

  useEffect(() => {
    const refreshVisible = () => { if (document.visibilityState !== "hidden") refresh(); };
    // Don't repeatedly abort a slow request before it has a chance to finish.
    // Explicit focus/reconnect/retry refreshes still supersede stale requests.
    const timer = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      if (!listLane.current.isPending()) void loadConversations();
      if (!threadLane.current.isPending()) void loadThread();
    }, 10_000);
    window.addEventListener("focus", refreshVisible);
    window.addEventListener("online", refreshVisible);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshVisible);
      window.removeEventListener("online", refreshVisible);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [refresh, loadConversations, loadThread]);

  useEffect(() => { if (isConnected) refresh(); }, [isConnected, refresh]);
  useEffect(() => {
    const event = wsEvent as { type?: string; senderId?: number } | null;
    if (event?.type !== "new_dm") return;
    void loadConversations();
    // Events also reach the sender's other sessions, not only the recipient.
    if (activeRef.current) void loadThread();
  }, [wsEvent, loadConversations, loadThread]);

  const input = activeUserId ? drafts[activeUserId] ?? "" : "";
  const setInput = (value: string) => {
    if (activeUserId) setDrafts((prev) => ({ ...prev, [activeUserId]: value }));
  };
  const sendMessage = async () => {
    const userId = activeUserId;
    const submitted = input;
    const recipient = thread?.otherUser;
    if (!userId || recipient?.id !== userId || !submitted.trim() || sendingRef.current || deletingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setSendErrors((prev) => ({ ...prev, [userId]: null }));
    const request = new AbortController();
    mutations.current.add(request);
    try {
      const message = await dmRequest<Message>(`${BASE}/api/dm/${userId}`, {
        method: "POST", headers: headers(), body: JSON.stringify({ content: submitted.trim() }), signal: request.signal,
      });
      if (!alive.current) return;
      // Invalidate reads taken before the send, so they cannot remove the new message.
      listLane.current.invalidate();
      if (activeRef.current === userId) {
        threadLane.current.invalidate();
        setLoadingThread(false);
        setThread((prev) => appendDmMessage(prev, userId, message));
      }
      setConversations((prev) => conversationAfterSend(prev, recipient, message));
      setLoadingConvs(false);
      setDrafts((prev) => ({ ...prev, [userId]: draftAfterSend(prev[userId] ?? "", submitted) }));
      void loadConversations();
      if (activeRef.current === userId) void loadThread();
    } catch (error) {
      if (!alive.current) return;
      setSendErrors((prev) => ({ ...prev, [userId]: dmErrorMessage(error) }));
      // A block or generic 403 must not render a paid-subscription prompt.
      const gate = dmSubscriptionGate(error);
      if (gate && activeRef.current === userId) setSubGate(gate);
    } finally {
      mutations.current.delete(request);
      if (alive.current) {
        sendingRef.current = false;
        setSending(false);
      }
    }
  };

  const requestDelete = (target: { userId: number; name: string | null }) => {
    setDeleteError(null);
    setDeleteTarget(target);
  };
  const deleteConversation = async (): Promise<number | null> => {
    const target = deleteTarget;
    if (!target || deletingRef.current || sendingRef.current) return null;
    deletingRef.current = true;
    setDeleting(true);
    setDeleteError(null);
    const request = new AbortController();
    mutations.current.add(request);
    try {
      await dmRequest(`${BASE}/api/dm/conversations/${target.userId}`, {
        method: "DELETE", headers: headers(), signal: request.signal,
      });
      if (!alive.current) return null;
      listLane.current.invalidate();
      setLoadingConvs(false);
      setConversations((prev) => prev.filter((conv) => conv.userId !== target.userId));
      if (activeRef.current === target.userId) {
        threadLane.current.invalidate();
        activeRef.current = null;
        setActiveUserId(null);
        setThread(null);
      }
      setDrafts((prev) => ({ ...prev, [target.userId]: "" }));
      setSendErrors((prev) => ({ ...prev, [target.userId]: null }));
      setDeleteTarget(null);
      notifyUnreadChanged();
      void loadConversations();
      return target.userId;
    } catch (error) {
      if (alive.current) setDeleteError(dmErrorMessage(error));
      return null;
    } finally {
      mutations.current.delete(request);
      if (alive.current) {
        deletingRef.current = false;
        setDeleting(false);
      }
    }
  };

  // Hide the old thread immediately during the render preceding effect cleanup.
  const visibleThread = thread?.otherUser.id === activeUserId ? thread : null;
  return {
    conversations, setConversations, activeUserId, setActiveUserId, thread: visibleThread, setThread,
    subGate: subGate?.creatorId === activeUserId ? subGate : null,
    loadingConvs, loadingThread, conversationsError, threadError,
    input, setInput, sending, sendMessage, sendError: activeUserId ? sendErrors[activeUserId] : null,
    loadConversations, loadThread, requestDelete, deleteTarget, setDeleteTarget,
    deleting, deleteError, deleteConversation,
  };
}