import { formatDistanceToNow } from "date-fns";
import { Link, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Bell, Heart, Users, Award, Info, BellOff, CheckCheck,
  FileText, Zap, TrendingUp, Star, BarChart3, Share2, ChevronRight
} from "lucide-react";
import { useNotifications } from "@/hooks/useNotifications";
import type {
  NotificationType as NotifType, NotificationItem as NotifItem, NotificationPreferences as Prefs,
} from "@/lib/notifications";

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

function parseDigest(body: string): DigestStats | null {
  if (!body.startsWith("DIGEST:")) return null;
  try {
    return JSON.parse(body.slice(7)) as DigestStats;
  } catch {
    return null;
  }
}

const PUBLIC_APP_URL = (import.meta.env.VITE_PUBLIC_APP_URL as string | undefined)?.trim() || "";

function buildDigestTweet(stats: DigestStats): string {
  const highlights: { score: number; text: string }[] = [];
  if (stats.peakRank !== null && stats.peakRank <= 10) highlights.push({ score: 100 - stats.peakRank, text: `hit #${stats.peakRank} on the leaderboard` });
  else if (stats.peakRank !== null) highlights.push({ score: 5, text: `climbed to #${stats.peakRank} on the leaderboard` });
  if (stats.likesEarned > 0) highlights.push({ score: stats.likesEarned, text: `earned ${stats.likesEarned} like${stats.likesEarned === 1 ? "" : "s"}` });
  if (stats.newSubscribers > 0) highlights.push({ score: stats.newSubscribers * 10, text: `picked up ${stats.newSubscribers} new subscriber${stats.newSubscribers === 1 ? "" : "s"}` });
  if (stats.currentStreak > 1) highlights.push({ score: stats.currentStreak * 3, text: `kept a ${stats.currentStreak} day streak alive` });
  if (stats.postsThisWeek > 0) highlights.push({ score: stats.postsThisWeek * 2, text: `shared ${stats.postsThisWeek} post${stats.postsThisWeek === 1 ? "" : "s"}` });
  const top = highlights.sort((a, b) => b.score - a.score).slice(0, 3).map((h) => h.text);
  const body = top.length
    ? `My week on @MonadFeet: I ${top.length > 1 ? `${top.slice(0, -1).join(", ")} and ${top[top.length - 1]}` : top[0]}. Now sitting at ${stats.totalPoints.toLocaleString()} points.`
    : `Building my streak on @MonadFeet. Now sitting at ${stats.totalPoints.toLocaleString()} points.`;
  const invitation = " What will you post first? Join us on @MonadFeet";
  return `${body}${invitation}${PUBLIC_APP_URL ? ` ${PUBLIC_APP_URL}` : ""}`;
}

function shareDigest(stats: DigestStats) {
  const url = `https://x.com/intent/tweet?text=${encodeURIComponent(buildDigestTweet(stats))}`;
  window.open(url, "_blank", "noopener,noreferrer");
}

function DigestCard({ stats, createdAt }: { stats: DigestStats; createdAt: string }) {
  const rankEmoji =
    stats.peakRank === 1 ? "1st" : stats.peakRank === 2 ? "2nd" : stats.peakRank === 3 ? "3rd" : null;

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
      value: rankEmoji ?? `#${stats.peakRank}`,
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
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
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
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="gap-2"
        onClick={(e) => { e.stopPropagation(); shareDigest(stats); }}
        data-testid="button-share-digest"
      >
        <Share2 className="h-3.5 w-3.5" /> Share my week on X
      </Button>
    </div>
  );
}

export default function Notifications() {
  const {
    data, unreadCount, isPending: loading, error, writeError, isSaving,
    markRead, markAllRead, updatePreferences, refetch,
  } = useNotifications();
  const notifs = data?.notifications ?? null;
  const prefs = data?.preferences ?? null;
  const notificationError = writeError ?? error;

  // Rejections are shown by the shared hook below, not converted to successful
  // reads or fabricated empty states.
  const togglePref = (key: keyof Prefs) => {
    if (!prefs) return;
    void updatePreferences({ [key]: !prefs[key] }).catch(() => {});
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 min-w-0">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 text-primary rounded-lg">
            <Bell className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Notifications</h1>
            <p className="text-muted-foreground text-sm" data-testid="status-notifications-unread">
              {loading ? "Loading notifications..." : !data ? "Notifications unavailable" : unreadCount > 0 ? `${unreadCount} unread` : "All caught up"}
            </p>
          </div>
        </div>
        {unreadCount > 0 && (
          <Button
            variant="outline" size="sm"
            onClick={() => { void markAllRead().catch(() => {}); }}
            disabled={isSaving}
            data-testid="button-notifications-read-all"
            className="gap-2 self-start sm:self-auto shrink-0 max-w-full"
          >
            <CheckCheck className="h-4 w-4" /> Mark all read
          </Button>
        )}
      </div>

      {notificationError && (
        <div role="alert" data-testid="error-notifications" className="flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
          <p>{notificationError.message}</p>
          {error && (
            <Button variant="outline" size="sm" data-testid="button-retry-notifications" onClick={() => { void refetch(); }}>
              Retry
            </Button>
          )}
        </div>
      )}

      <Tabs defaultValue="all">
        <TabsList className="w-full">
          <TabsTrigger value="all" className="flex-1" data-testid="tab-notifications-all">All</TabsTrigger>
          <TabsTrigger value="unread" className="flex-1" data-testid="tab-notifications-unread">
            Unread{" "}
            {unreadCount > 0 && (
              <Badge className="ml-1.5 px-1.5 py-0 text-xs">{unreadCount}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="settings" className="flex-1" data-testid="tab-notifications-settings">Alert Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="mt-4">
          <NotifList notifs={notifs} loading={loading} failed={!!error} saving={isSaving} onMarkRead={markRead} />
        </TabsContent>

        <TabsContent value="unread" className="mt-4">
          <NotifList
            notifs={notifs?.filter((n) => !n.read) ?? null}
            loading={loading}
            failed={!!error}
            saving={isSaving}
            onMarkRead={markRead}
          />
        </TabsContent>

        <TabsContent value="settings" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Bell className="h-4 w-4" /> Alert Settings
                {isSaving && (
                  <span className="text-xs text-muted-foreground font-normal ml-2">Saving...</span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {!prefs ? (
                <p className="text-sm text-muted-foreground">
                  {error ? "Notification preferences unavailable. Retry above." : "Loading preferences..."}
                </p>
              ) : (
                <>
                  <PrefRow
                    icon={<Heart className="h-4 w-4 text-red-500" />}
                    label="Post Likes"
                    description="When someone likes one of your posts"
                    enabled={prefs.likesEnabled}
                    disabled={isSaving}
                    onToggle={() => togglePref("likesEnabled")}
                  />
                  <PrefRow
                    icon={<Users className="h-4 w-4 text-purple-500" />}
                    label="Subscriptions"
                    description="When someone subscribes or renews their subscription"
                    enabled={prefs.subscriptionsEnabled}
                    disabled={isSaving}
                    onToggle={() => togglePref("subscriptionsEnabled")}
                  />
                  <PrefRow
                    icon={<Award className="h-4 w-4 text-yellow-500" />}
                    label="Badges"
                    description="When you earn a new loyalty badge"
                    enabled={prefs.badgesEnabled}
                    disabled={isSaving}
                    onToggle={() => togglePref("badgesEnabled")}
                  />
                  <PrefRow
                    icon={<Info className="h-4 w-4 text-blue-500" />}
                    label="System Alerts"
                    description="Platform updates, invite codes, weekly digest, and announcements"
                    enabled={prefs.systemEnabled}
                    disabled={isSaving}
                    onToggle={() => togglePref("systemEnabled")}
                  />
                  <PrefRow
                    icon={<BarChart3 className="h-4 w-4 text-primary" />}
                    label="Weekly Digest"
                    description="Your stats every Sunday: posts, likes, rank, and streak"
                    enabled={prefs.systemEnabled}
                    disabled={isSaving}
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
  failed,
  saving,
  onMarkRead,
}: {
  notifs: NotifItem[] | null;
  loading: boolean;
  failed: boolean;
  saving: boolean;
  onMarkRead: (id: number) => Promise<void>;
}) {
  const [, navigate] = useLocation();
  if (failed && !notifs) return null;
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
        const postHref = n.resourceType === "post" && n.resourceId != null && String(n.resourceId) !== "" ? `/post/${n.resourceId}` : null;
        const profileHref = n.actorId != null ? `/profile/${n.actorId}` : null;
        const open = () => {
          if (!n.read) void onMarkRead(n.id).catch(() => {});
          if (postHref) navigate(postHref);
        };
        const avatar = n.actorAvatarUrl || profileHref ? (
          <Avatar className="h-8 w-8">
            <AvatarImage src={n.actorAvatarUrl ?? ""} />
            <AvatarFallback>{n.actorName?.slice(0, 2).toUpperCase() ?? "??"}</AvatarFallback>
          </Avatar>
        ) : (
          <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center">
            {NOTIF_ICONS[n.type] ?? <Bell className="h-4 w-4" />}
          </div>
        );
        return (
          <div
            key={n.id}
            role="button"
            tabIndex={0}
            aria-disabled={saving}
            onClick={open}
            onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); open(); } }}
            data-testid={`button-notification-read-${n.id}`}
            className={`w-full text-left rounded-lg border transition-colors p-4 flex items-start gap-3 cursor-pointer hover:border-primary/40 ${
              n.read ? "bg-background border-border/50" : "bg-primary/5 border-primary/20"
            }`}
          >
            {!digest && (
              <div className="flex-shrink-0 mt-0.5">
                {profileHref ? (
                  <Link href={profileHref} onClick={(e) => e.stopPropagation()} aria-label={`Open ${n.actorName ?? "user"} profile`} data-testid={`link-notification-actor-avatar-${n.id}`}>
                    {avatar}
                  </Link>
                ) : avatar}
              </div>
            )}

            <div className="flex-1 min-w-0">
              {digest ? (
                <DigestCard stats={digest} createdAt={n.createdAt} />
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">{n.title}</p>
                    {!n.read && <span className="h-2 w-2 rounded-full bg-primary flex-shrink-0" />}
                  </div>
                  {profileHref && n.actorName && (
                    <Link href={profileHref} onClick={(e) => e.stopPropagation()} className="text-xs font-semibold text-primary hover:underline" data-testid={`link-notification-actor-${n.id}`}>
                      {n.actorName}{n.actorUsername ? ` @${n.actorUsername}` : ""}
                    </Link>
                  )}
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{n.body}</p>
                  <p className="text-xs text-muted-foreground/60 mt-1">
                    {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                    {postHref && <span className="ml-2 text-primary">View post</span>}
                  </p>
                </>
              )}
            </div>

            {digest && !n.read && <span className="flex-shrink-0 h-2 w-2 rounded-full bg-primary mt-1" />}
            {!digest && (
              <div className="flex-shrink-0 flex items-center gap-1">
                {NOTIF_ICONS[n.type]}
                {postHref && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
              </div>
            )}
          </div>
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
  disabled,
  onToggle,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  enabled: boolean;
  disabled: boolean;
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
      <Switch
        checked={enabled} disabled={disabled} onCheckedChange={onToggle}
        data-testid={`switch-notifications-${label.toLowerCase().replace(/\s+/g, "-")}`}
      />
    </div>
  );
}
