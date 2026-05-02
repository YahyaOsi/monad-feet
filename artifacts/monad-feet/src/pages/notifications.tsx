import { useState, useEffect } from "react";
import { formatDistanceToNow } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Bell, Heart, Users, Award, Info, BellOff, CheckCheck,
  FileText, Zap, TrendingUp, Star, MessageSquare, BarChart3
} from "lucide-react";
import { useUser } from "@/context/UserContext";

type NotifType = "like" | "subscription" | "badge" | "system";

interface NotifItem {
  id: number;
  type: NotifType;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
  actorName?: string | null;
  actorAvatarUrl?: string | null;
  actorUsername?: string | null;
}

interface Prefs {
  likesEnabled: boolean;
  subscriptionsEnabled: boolean;
  badgesEnabled: boolean;
  systemEnabled: boolean;
}

type DigestStats = {
  postsThisWeek: number;
  likesEarned: number;
  newSubscribers: number;
  currentStreak: number;
  totalPoints: number;
  peakRank: number | null;
};

const NOTIF_ICONS: Record<NotifType, React.ReactNode> = {
  like: <Heart className="h-4 w-4 text-red-500" />,
  subscription: <Users className="h-4 w-4 text-purple-500" />,
  badge: <Award className="h-4 w-4 text-yellow-500" />,
  system: <Info className="h-4 w-4 text-blue-500" />,
};

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function apiFetch(path: string, opts: RequestInit = {}) {
  const wallet = localStorage.getItem("mf_wallet_address") ?? "";
  return fetch(`${BASE}/api${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", "x-wallet-address": wallet, ...(opts.headers ?? {}) },
  });
}

function parseDigest(body: string): DigestStats | null {
  if (!body.startsWith("DIGEST:")) return null;
  try {
    return JSON.parse(body.slice(7)) as DigestStats;
  } catch {
    return null;
  }
}

function DigestCard({ stats, createdAt }: { stats: DigestStats; createdAt: string }) {
  const rankEmoji =
    stats.peakRank === 1 ? "🥇" : stats.peakRank === 2 ? "🥈" : stats.peakRank === 3 ? "🥉" : null;

  const chips: { icon: React.ReactNode; label: string; value: string; color: string }[] = [
    {
      icon: <FileText className="h-3.5 w-3.5" />,
      label: "Posts",
      value: String(stats.postsThisWeek),
      color: "text-blue-600 bg-blue-50 border-blue-100",
    },
    {
      icon: <Heart className="h-3.5 w-3.5" />,
      label: "Likes earned",
      value: String(stats.likesEarned),
      color: "text-rose-600 bg-rose-50 border-rose-100",
    },
    {
      icon: <Users className="h-3.5 w-3.5" />,
      label: "New subscribers",
      value: String(stats.newSubscribers),
      color: "text-purple-600 bg-purple-50 border-purple-100",
    },
    {
      icon: <Zap className="h-3.5 w-3.5" />,
      label: "Streak",
      value: `${stats.currentStreak}d`,
      color: "text-orange-600 bg-orange-50 border-orange-100",
    },
    {
      icon: <Star className="h-3.5 w-3.5" />,
      label: "Points",
      value: String(stats.totalPoints),
      color: "text-amber-600 bg-amber-50 border-amber-100",
    },
  ];

  if (stats.peakRank !== null) {
    chips.push({
      icon: <TrendingUp className="h-3.5 w-3.5" />,
      label: "Peak rank",
      value: `${rankEmoji ?? ""}#${stats.peakRank}`,
      color: "text-emerald-600 bg-emerald-50 border-emerald-100",
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="p-1.5 bg-primary/10 rounded-lg">
          <BarChart3 className="h-4 w-4 text-primary" />
        </div>
        <div>
          <p className="text-sm font-semibold">Your week on Monad Feet</p>
          <p className="text-xs text-muted-foreground">
            {formatDistanceToNow(new Date(createdAt), { addSuffix: true })}
          </p>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {chips.map((chip) => (
          <div
            key={chip.label}
            className={`flex flex-col items-center gap-1 p-2 rounded-lg border text-center ${chip.color}`}
          >
            <div className="flex items-center gap-1">
              {chip.icon}
              <span className="text-base font-bold">{chip.value}</span>
            </div>
            <span className="text-[10px] font-medium opacity-80 leading-tight">{chip.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Notifications() {
  const { user } = useUser();
  const [notifs, setNotifs] = useState<NotifItem[] | null>(null);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [prefsSaving, setPrefsSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    apiFetch("/notifications")
      .then((r) => r.json())
      .then((data) => {
        setNotifs(data.notifications ?? []);
        setPrefs(data.preferences ?? null);
        setUnreadCount(data.unreadCount ?? 0);
      })
      .catch(() => setNotifs([]))
      .finally(() => setLoading(false));
  }, [user]);

  const markRead = async (id: number) => {
    await apiFetch(`/notifications/${id}/read`, { method: "POST" });
    setNotifs((prev) => prev?.map((n) => (n.id === id ? { ...n, read: true } : n)) ?? null);
    setUnreadCount((c) => Math.max(0, c - 1));
  };

  const markAllRead = async () => {
    await apiFetch("/notifications/read-all", { method: "POST" });
    setNotifs((prev) => prev?.map((n) => ({ ...n, read: true })) ?? null);
    setUnreadCount(0);
  };

  const togglePref = async (key: keyof Prefs) => {
    if (!prefs) return;
    const newVal = !prefs[key];
    const updated = { ...prefs, [key]: newVal };
    setPrefs(updated);
    setPrefsSaving(true);
    try {
      await apiFetch("/notifications/preferences", {
        method: "PUT",
        body: JSON.stringify({ [key]: newVal }),
      });
    } finally {
      setPrefsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 text-primary rounded-lg">
            <Bell className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Notifications</h1>
            <p className="text-muted-foreground text-sm">
              {unreadCount > 0 ? `${unreadCount} unread` : "All caught up"}
            </p>
          </div>
        </div>
        {unreadCount > 0 && (
          <Button variant="outline" size="sm" onClick={markAllRead} className="gap-2">
            <CheckCheck className="h-4 w-4" /> Mark all read
          </Button>
        )}
      </div>

      <Tabs defaultValue="all">
        <TabsList className="w-full">
          <TabsTrigger value="all" className="flex-1">All</TabsTrigger>
          <TabsTrigger value="unread" className="flex-1">
            Unread{" "}
            {unreadCount > 0 && (
              <Badge className="ml-1.5 px-1.5 py-0 text-xs">{unreadCount}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="settings" className="flex-1">Alert Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="mt-4">
          <NotifList notifs={notifs} loading={loading} onMarkRead={markRead} />
        </TabsContent>

        <TabsContent value="unread" className="mt-4">
          <NotifList
            notifs={notifs?.filter((n) => !n.read) ?? null}
            loading={loading}
            onMarkRead={markRead}
          />
        </TabsContent>

        <TabsContent value="settings" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Bell className="h-4 w-4" /> Alert Settings
                {prefsSaving && (
                  <span className="text-xs text-muted-foreground font-normal ml-2">Saving...</span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {!prefs ? (
                <p className="text-sm text-muted-foreground">Loading preferences...</p>
              ) : (
                <>
                  <PrefRow
                    icon={<Heart className="h-4 w-4 text-red-500" />}
                    label="Post Likes"
                    description="When someone likes one of your posts"
                    enabled={prefs.likesEnabled}
                    onToggle={() => togglePref("likesEnabled")}
                  />
                  <PrefRow
                    icon={<Users className="h-4 w-4 text-purple-500" />}
                    label="Subscriptions"
                    description="When someone subscribes or renews their subscription"
                    enabled={prefs.subscriptionsEnabled}
                    onToggle={() => togglePref("subscriptionsEnabled")}
                  />
                  <PrefRow
                    icon={<Award className="h-4 w-4 text-yellow-500" />}
                    label="Badges"
                    description="When you earn a new loyalty badge"
                    enabled={prefs.badgesEnabled}
                    onToggle={() => togglePref("badgesEnabled")}
                  />
                  <PrefRow
                    icon={<Info className="h-4 w-4 text-blue-500" />}
                    label="System Alerts"
                    description="Platform updates, invite codes, weekly digest, and announcements"
                    enabled={prefs.systemEnabled}
                    onToggle={() => togglePref("systemEnabled")}
                  />
                  <PrefRow
                    icon={<BarChart3 className="h-4 w-4 text-primary" />}
                    label="Weekly Digest"
                    description="Your personal stats every Sunday — posts, likes, rank, and streak"
                    enabled={prefs.systemEnabled}
                    onToggle={() => togglePref("systemEnabled")}
                  />
                  {!prefs.likesEnabled &&
                    !prefs.subscriptionsEnabled &&
                    !prefs.badgesEnabled &&
                    !prefs.systemEnabled && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground pt-2 border-t">
                        <BellOff className="h-4 w-4" /> All notifications are disabled.
                      </div>
                    )}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function NotifList({
  notifs,
  loading,
  onMarkRead,
}: {
  notifs: NotifItem[] | null;
  loading: boolean;
  onMarkRead: (id: number) => void;
}) {
  if (loading) {
    return (
      <div className="space-y-3">
        {[...Array(4)].map((_, i) => (
          <Card key={i} className="animate-pulse">
            <CardContent className="h-16 p-4" />
          </Card>
        ))}
      </div>
    );
  }
  if (!notifs || notifs.length === 0) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <Bell className="h-10 w-10 mx-auto mb-3 opacity-30" />
        <p>No notifications yet.</p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {notifs.map((n) => {
        const digest = parseDigest(n.body);
        return (
          <button
            key={n.id}
            onClick={() => !n.read && onMarkRead(n.id)}
            className={`w-full text-left rounded-lg border transition-colors p-4 flex items-start gap-3 ${
              n.read
                ? "bg-background border-border/50"
                : "bg-primary/5 border-primary/20"
            }`}
          >
            {/* Avatar / icon */}
            {!digest && (
              <div className="flex-shrink-0 mt-0.5">
                {n.actorAvatarUrl ? (
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={n.actorAvatarUrl} />
                    <AvatarFallback>{n.actorName?.slice(0, 2).toUpperCase() ?? "??"}</AvatarFallback>
                  </Avatar>
                ) : (
                  <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center">
                    {NOTIF_ICONS[n.type] ?? <Bell className="h-4 w-4" />}
                  </div>
                )}
              </div>
            )}

            {/* Content */}
            <div className="flex-1 min-w-0">
              {digest ? (
                /* ── Digest card ── */
                <DigestCard stats={digest} createdAt={n.createdAt} />
              ) : (
                /* ── Regular notification ── */
                <>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">{n.title}</p>
                    {!n.read && <span className="h-2 w-2 rounded-full bg-primary flex-shrink-0" />}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{n.body}</p>
                  <p className="text-xs text-muted-foreground/60 mt-1">
                    {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                  </p>
                </>
              )}
            </div>

            {/* Unread dot for digest */}
            {digest && !n.read && (
              <span className="flex-shrink-0 h-2 w-2 rounded-full bg-primary mt-1" />
            )}

            {/* Type icon for regular */}
            {!digest && (
              <div className="flex-shrink-0">{NOTIF_ICONS[n.type]}</div>
            )}
          </button>
        );
      })}
    </div>
  );
}

function PrefRow({
  icon,
  label,
  description,
  enabled,
  onToggle,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 p-1.5 bg-muted rounded-md">{icon}</div>
        <div>
          <p className="text-sm font-medium">{label}</p>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      <Switch checked={enabled} onCheckedChange={onToggle} />
    </div>
  );
}
