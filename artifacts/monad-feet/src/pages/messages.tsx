import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { formatDistanceToNow } from "date-fns";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  MessageCircle, Send, Lock, ChevronLeft, Settings2,
  Shield, Loader2, Star, AlertCircle
} from "lucide-react";
import { useUser } from "@/context/UserContext";
import { usePresence } from "@/hooks/usePresence";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function getWallet() { return localStorage.getItem("mf_wallet_address") ?? ""; }
function authHeaders() { return { "x-wallet-address": getWallet(), "Content-Type": "application/json" }; }

type Conversation = {
  userId: number;
  name: string | null;
  username: string | null;
  avatarUrl: string | null;
  dmRequiresSubscription: boolean;
  lastMessage: { content: string; sentByMe: boolean; at: string };
  unreadCount: number;
};

type Message = {
  id: number;
  content: string;
  sentByMe: boolean;
  readAt: string | null;
  createdAt: string;
};

type OtherUser = {
  id: number;
  name: string | null;
  username: string | null;
  avatarUrl: string | null;
  dmRequiresSubscription: boolean;
  subscriptionPrice: number | null;
};

type ThreadData = {
  otherUser: OtherUser;
  messages: Message[];
};

type SubGateError = {
  creatorId: number;
  message: string;
  creatorName: string | null;
  subscriptionPrice: number | null;
};

// ── Conversation list item ──────────────────────────────────────

function ConvItem({
  conv,
  isActive,
  onClick,
}: {
  conv: Conversation;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-muted/60 ${
        isActive ? "bg-primary/8 border-r-2 border-primary" : ""
      }`}
    >
      <div className="relative flex-shrink-0">
        <Avatar className="h-10 w-10">
          <AvatarImage src={conv.avatarUrl ?? ""} />
          <AvatarFallback className="text-xs font-semibold bg-primary/10 text-primary">
            {conv.name?.slice(0, 2).toUpperCase() ?? "??"}
          </AvatarFallback>
        </Avatar>
        {conv.dmRequiresSubscription && (
          <div className="absolute -bottom-0.5 -right-0.5 h-4 w-4 bg-amber-500 rounded-full flex items-center justify-center border border-background">
            <Lock className="h-2 w-2 text-white" />
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold truncate">{conv.name ?? conv.username ?? "Unknown"}</span>
          <span className="text-[10px] text-muted-foreground flex-shrink-0 ml-2">
            {formatDistanceToNow(new Date(conv.lastMessage.at), { addSuffix: false })}
          </span>
        </div>
        <p className="text-xs text-muted-foreground truncate">
          {conv.lastMessage.sentByMe ? "You: " : ""}{conv.lastMessage.content}
        </p>
      </div>
      {conv.unreadCount > 0 && (
        <span className="flex-shrink-0 h-5 w-5 bg-primary text-primary-foreground text-[10px] font-bold rounded-full flex items-center justify-center">
          {conv.unreadCount > 9 ? "9+" : conv.unreadCount}
        </span>
      )}
    </button>
  );
}

// ── Message bubble ─────────────────────────────────────────────

function MsgBubble({ msg }: { msg: Message }) {
  return (
    <div className={`flex ${msg.sentByMe ? "justify-end" : "justify-start"} mb-2`}>
      <div
        className={`max-w-[75%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
          msg.sentByMe
            ? "bg-primary text-primary-foreground rounded-br-sm"
            : "bg-muted text-foreground rounded-bl-sm"
        }`}
      >
        <p className="whitespace-pre-wrap break-words">{msg.content}</p>
        <p className={`text-[10px] mt-1 ${msg.sentByMe ? "text-primary-foreground/60 text-right" : "text-muted-foreground"}`}>
          {formatDistanceToNow(new Date(msg.createdAt), { addSuffix: true })}
          {msg.sentByMe && msg.readAt && " · Read"}
        </p>
      </div>
    </div>
  );
}

// ── Subscription gate ──────────────────────────────────────────

function SubGate({ err, onSubscribe }: { err: SubGateError; onSubscribe: () => void }) {
  const [loading, setLoading] = useState(false);

  const handleSubscribe = async () => {
    setLoading(true);
    const wallet = getWallet();
    try {
      await fetch(`${BASE}/api/subscriptions`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ subscriberWalletAddress: wallet, creatorId: err.creatorId }),
      });
      onSubscribe();
    } catch {
      // retry
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="h-16 w-16 rounded-full bg-amber-100 flex items-center justify-center">
        <Lock className="h-8 w-8 text-amber-600" />
      </div>
      <div>
        <p className="font-semibold text-lg">Paid DMs</p>
        <p className="text-muted-foreground text-sm mt-1 max-w-xs">{err.message}</p>
        {err.subscriptionPrice !== null && err.subscriptionPrice > 0 && (
          <p className="mt-2 text-sm font-medium text-primary">
            {err.subscriptionPrice} MON / month
          </p>
        )}
      </div>
      <Button onClick={() => void handleSubscribe()} disabled={loading} className="gap-2">
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Star className="h-4 w-4" />}
        Subscribe to Unlock DMs
      </Button>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────

export default function MessagesPage() {
  const { user } = useUser();
  const [, navigate] = useLocation();
  const { wsEvent } = usePresence();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeUserId, setActiveUserId] = useState<number | null>(null);
  const [thread, setThread] = useState<ThreadData | null>(null);
  const [subGate, setSubGate] = useState<SubGateError | null>(null);
  const [loadingThread, setLoadingThread] = useState(false);
  const [loadingConvs, setLoadingConvs] = useState(true);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [dmPaid, setDmPaid] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [mobileView, setMobileView] = useState<"list" | "thread">("list");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load conversations
  const loadConversations = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/dm/conversations`, { headers: { "x-wallet-address": getWallet() } });
      if (res.ok) {
        const data = await res.json() as Conversation[];
        setConversations(data);
      }
    } catch { /* ignore */ } finally {
      setLoadingConvs(false);
    }
  }, []);

  useEffect(() => { void loadConversations(); }, [loadConversations]);

  // Sync dmPaid setting from user profile
  useEffect(() => {
    if (!user) return;
    const fetchUser = async () => {
      try {
        const res = await fetch(`${BASE}/api/users/${user.id}`, { headers: { "x-wallet-address": getWallet() } });
        if (res.ok) {
          const u = await res.json() as { dmRequiresSubscription?: boolean };
          setDmPaid(u.dmRequiresSubscription ?? false);
        }
      } catch { /* ignore */ }
    };
    void fetchUser();
  }, [user]);

  // Load thread when activeUserId changes
  useEffect(() => {
    if (!activeUserId) { setThread(null); setSubGate(null); return; }
    setLoadingThread(true);
    setSubGate(null);
    fetch(`${BASE}/api/dm/${activeUserId}`, { headers: { "x-wallet-address": getWallet() } })
      .then(async (res) => {
        if (res.status === 403) {
          const err = await res.json() as SubGateError;
          setSubGate(err);
          setThread(null);
        } else if (res.ok) {
          const data = await res.json() as ThreadData;
          setThread(data);
          setSubGate(null);
        }
      })
      .catch(() => { })
      .finally(() => setLoadingThread(false));
  }, [activeUserId]);

  // Scroll to bottom when messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [thread?.messages.length]);

  // Handle real-time new DM events
  useEffect(() => {
    if (!wsEvent) return;
    const ev = wsEvent as { type?: string; senderId?: number };
    if (ev.type === "new_dm") {
      void loadConversations();
      // If we're looking at this sender's thread, refresh it
      if (ev.senderId === activeUserId) {
        fetch(`${BASE}/api/dm/${activeUserId}`, { headers: { "x-wallet-address": getWallet() } })
          .then((r) => r.ok ? r.json() as Promise<ThreadData> : Promise.reject())
          .then((data) => setThread(data))
          .catch(() => { });
      }
    }
  }, [wsEvent, activeUserId, loadConversations]);

  const openThread = (userId: number) => {
    setActiveUserId(userId);
    setMobileView("thread");
  };

  const sendMessage = async () => {
    if (!input.trim() || !activeUserId || sending) return;
    setSending(true);
    const content = input.trim();
    setInput("");
    try {
      const res = await fetch(`${BASE}/api/dm/${activeUserId}`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ content }),
      });
      if (res.status === 403) {
        const err = await res.json() as SubGateError;
        setSubGate(err);
        return;
      }
      if (res.ok) {
        const msg = await res.json() as Message;
        setThread((prev) =>
          prev ? { ...prev, messages: [...prev.messages, msg] } : prev,
        );
        void loadConversations();
      }
    } catch { /* ignore */ } finally {
      setSending(false);
    }
  };

  const saveSettings = async (val: boolean) => {
    setSavingSettings(true);
    try {
      await fetch(`${BASE}/api/dm/settings`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ dmRequiresSubscription: val }),
      });
      setDmPaid(val);
    } catch { /* ignore */ } finally {
      setSavingSettings(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 text-primary rounded-lg">
            <MessageCircle className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Messages</h1>
            <p className="text-muted-foreground text-sm">Private, encrypted-by-trust DMs</p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="gap-2 text-muted-foreground"
          onClick={() => setShowSettings((s) => !s)}
        >
          <Settings2 className="h-4 w-4" />
          <span className="hidden sm:inline">DM Settings</span>
        </Button>
      </div>

      {/* Settings panel */}
      {showSettings && (
        <Card className="p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 font-semibold">
                <Lock className="h-4 w-4 text-amber-500" />
                Paid DMs
                {dmPaid && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
                    Active
                  </span>
                )}
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                When enabled, only your subscribers can send you direct messages. This lets you monetize your DM access.
              </p>
              {dmPaid && (
                <p className="text-xs text-amber-700 mt-2 flex items-center gap-1.5">
                  <Shield className="h-3.5 w-3.5" />
                  Non-subscribers will see a subscribe prompt before they can message you.
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {savingSettings && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
              <Switch
                checked={dmPaid}
                onCheckedChange={(val) => void saveSettings(val)}
                disabled={savingSettings}
              />
            </div>
          </div>
          {!user?.subscriptionPrice && dmPaid && (
            <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2 text-xs text-amber-800">
              <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <span>
                You haven't set a subscription price yet. Go to your Profile settings to set one so subscribers know what to pay.
              </span>
            </div>
          )}
        </Card>
      )}

      {/* Messaging panel */}
      <div className="border rounded-xl overflow-hidden bg-background" style={{ height: "calc(100vh - 280px)", minHeight: 400 }}>
        <div className="flex h-full">

          {/* ── Conversation list ─────────────────────────── */}
          <div className={`
            flex flex-col border-r bg-muted/20
            ${activeUserId ? "hidden md:flex md:w-72 lg:w-80" : "flex w-full md:w-72 lg:w-80"}
          `}>
            <div className="px-4 py-3 border-b bg-background flex items-center justify-between">
              <span className="font-semibold text-sm">Conversations</span>
              <span className="text-xs text-muted-foreground">{conversations.length}</span>
            </div>
            <div className="flex-1 overflow-y-auto">
              {loadingConvs ? (
                <div className="flex items-center justify-center h-24">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : conversations.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-3 p-6 text-center">
                  <MessageCircle className="h-10 w-10 text-muted-foreground/30" />
                  <p className="text-sm text-muted-foreground">No conversations yet</p>
                  <p className="text-xs text-muted-foreground">
                    Visit a member's profile and tap "Message" to start a conversation.
                  </p>
                </div>
              ) : (
                conversations.map((conv) => (
                  <ConvItem
                    key={conv.userId}
                    conv={conv}
                    isActive={activeUserId === conv.userId}
                    onClick={() => openThread(conv.userId)}
                  />
                ))
              )}
            </div>
          </div>

          {/* ── Thread panel ─────────────────────────────── */}
          <div className={`
            flex flex-col flex-1 min-w-0
            ${activeUserId ? "flex" : "hidden md:flex"}
          `}>
            {!activeUserId ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground p-6">
                <MessageCircle className="h-12 w-12 opacity-20" />
                <p className="text-sm">Select a conversation</p>
              </div>
            ) : loadingThread ? (
              <div className="flex-1 flex items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : subGate ? (
              <>
                {/* Thread header with back button */}
                <div className="px-4 py-3 border-b flex items-center gap-3 bg-background">
                  <button
                    className="md:hidden p-1 text-muted-foreground hover:text-foreground"
                    onClick={() => { setActiveUserId(null); setMobileView("list"); }}
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                </div>
                <SubGate
                  err={subGate}
                  onSubscribe={() => {
                    setSubGate(null);
                    setActiveUserId((id) => id); // re-trigger load
                  }}
                />
              </>
            ) : thread ? (
              <>
                {/* Thread header */}
                <div className="px-4 py-3 border-b flex items-center gap-3 bg-background flex-shrink-0">
                  <button
                    className="md:hidden p-1 text-muted-foreground hover:text-foreground"
                    onClick={() => { setActiveUserId(null); setMobileView("list"); }}
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={thread.otherUser.avatarUrl ?? ""} />
                    <AvatarFallback className="text-xs bg-primary/10 text-primary font-semibold">
                      {thread.otherUser.name?.slice(0, 2).toUpperCase() ?? "??"}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm truncate">
                        {thread.otherUser.name ?? thread.otherUser.username ?? "Unknown"}
                      </span>
                      {thread.otherUser.dmRequiresSubscription && (
                        <span className="flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200 flex-shrink-0">
                          <Lock className="h-2 w-2" /> Paid DMs
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">@{thread.otherUser.username ?? "—"}</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs text-muted-foreground"
                    onClick={() => navigate(`/profile/${thread.otherUser.id}`)}
                  >
                    Profile
                  </Button>
                </div>

                {/* Messages */}
                <div className="flex-1 overflow-y-auto px-4 py-4">
                  {thread.messages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
                      <MessageCircle className="h-8 w-8 opacity-20" />
                      <p className="text-sm">No messages yet — say hi!</p>
                    </div>
                  ) : (
                    thread.messages.map((msg) => <MsgBubble key={msg.id} msg={msg} />)
                  )}
                  <div ref={bottomRef} />
                </div>

                {/* Compose */}
                <div className="px-4 py-3 border-t bg-background flex-shrink-0">
                  <div className="flex items-end gap-2">
                    <textarea
                      ref={inputRef}
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          void sendMessage();
                        }
                      }}
                      placeholder="Type a message… (Enter to send)"
                      rows={1}
                      className="flex-1 resize-none rounded-xl border bg-muted/50 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/50 transition-all max-h-32"
                      style={{ overflow: "auto" }}
                    />
                    <Button
                      size="sm"
                      onClick={() => void sendMessage()}
                      disabled={!input.trim() || sending}
                      className="h-10 w-10 p-0 rounded-xl flex-shrink-0"
                    >
                      {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
