import { useState, useEffect, useCallback, useRef } from "react";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Trophy, Flame, Users, Zap, Star, Link2, Shield, Heart, RotateCcw } from "lucide-react";
import { useContractUserCount } from "@/lib/useOnChain";
import { CONTRACT_DEPLOYED } from "@/lib/contract";
import { useUser } from "@/context/UserContext";
import { useActivityFeed } from "@/hooks/usePresence";
import { Button } from "@/components/ui/button";

interface LeaderEntry {
  rank: number;
  userId: number;
  name?: string | null;
  username?: string | null;
  avatarUrl?: string | null;
  totalPoints: number;
  currentStreak: number;
  longestStreak: number;
  postCount: number;
  likeCount: number;
  subscriberCount: number;
  engagementScore: number;
  registrationTxHash?: string | null;
}

type SortBy = "points" | "subscribers" | "engagement" | "likes";
type Period = "alltime" | "weekly";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function fetchLeaderboard(sortBy: SortBy, period: Period): Promise<LeaderEntry[]> {
  const res = await fetch(`${BASE}/api/leaderboard?sortBy=${sortBy}&period=${period}`);
  if (!res.ok) return [];
  const data = await res.json() as { entries?: LeaderEntry[] };
  return data.entries ?? [];
}

// ── Podium (top 3) ───────────────────────────────────────────────

const PODIUM_CONFIG = [
  { pos: 2, height: "h-20", bg: "bg-slate-100 border-slate-300", label: "2nd", emoji: "🥈", textColor: "text-slate-500" },
  { pos: 1, height: "h-28", bg: "bg-yellow-50 border-yellow-300", label: "1st", emoji: "🥇", textColor: "text-yellow-600" },
  { pos: 3, height: "h-16", bg: "bg-amber-50 border-amber-300", label: "3rd", emoji: "🥉", textColor: "text-amber-600" },
];

function PodiumSlot({
  entry,
  pos,
  height,
  bg,
  label,
  emoji,
  textColor,
  metricValue,
  metricLabel,
  isCurrentUser,
}: {
  entry: LeaderEntry | undefined;
  pos: number;
  height: string;
  bg: string;
  label: string;
  emoji: string;
  textColor: string;
  metricValue: number;
  metricLabel: string;
  isCurrentUser: boolean;
}) {
  if (!entry) {
    return (
      <div className="flex flex-col items-center gap-2 flex-1">
        <div className="h-14 w-14 rounded-full bg-muted border-2 border-dashed border-muted-foreground/20 flex items-center justify-center">
          <span className="text-xl">{emoji}</span>
        </div>
        <div className={`w-full ${height} ${bg} border-2 rounded-t-lg flex items-center justify-center`}>
          <span className={`text-xs font-bold ${textColor}`}>{label}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2 flex-1">
      <Link href={`/profile/${entry.userId}`}>
        <div className="relative">
          <Avatar className={`h-14 w-14 cursor-pointer border-4 ${isCurrentUser ? "border-primary" : pos === 1 ? "border-yellow-400" : pos === 2 ? "border-slate-400" : "border-amber-600"} shadow-md`}>
            <AvatarImage src={entry.avatarUrl ?? ""} />
            <AvatarFallback className="bg-primary/10 text-primary font-bold text-base">
              {entry.name?.slice(0, 2).toUpperCase() ?? "??"}
            </AvatarFallback>
          </Avatar>
          <span className="absolute -bottom-1 -right-1 text-base">{emoji}</span>
          {CONTRACT_DEPLOYED && entry.registrationTxHash && (
            <div className="absolute -top-1 -right-1 h-4 w-4 bg-violet-600 rounded-full flex items-center justify-center border border-white">
              <Shield className="h-2 w-2 text-white" />
            </div>
          )}
        </div>
      </Link>
      <div className="text-center">
        <p className="text-xs font-semibold leading-tight truncate max-w-[72px]">
          {entry.name ?? "Anonymous"}
        </p>
        {isCurrentUser && (
          <span className="text-[9px] font-bold text-primary bg-primary/10 px-1 rounded">You</span>
        )}
      </div>
      <div className={`w-full ${height} ${bg} border-2 rounded-t-lg flex flex-col items-center justify-center gap-0.5 shadow-sm`}>
        <span className={`text-base font-bold ${textColor}`}>{metricValue.toLocaleString()}</span>
        <span className="text-[9px] text-muted-foreground font-medium uppercase tracking-wide">{metricLabel}</span>
      </div>
    </div>
  );
}

// ── Row ──────────────────────────────────────────────────────────

function LeaderRow({
  entry,
  metricValue,
  metricLabel,
  metricIcon,
  isCurrentUser,
}: {
  entry: LeaderEntry;
  metricValue: number;
  metricLabel: string;
  metricIcon: React.ReactNode;
  isCurrentUser: boolean;
}) {
  const hasStreak = entry.currentStreak > 0;
  const isChainVerified = !!entry.registrationTxHash;

  const rankEl =
    entry.rank === 1 ? <span className="text-xl">🥇</span> :
    entry.rank === 2 ? <span className="text-xl">🥈</span> :
    entry.rank === 3 ? <span className="text-xl">🥉</span> :
    <span className="text-sm font-bold text-muted-foreground w-7 text-center inline-block">#{entry.rank}</span>;

  return (
    <div className={`flex items-center justify-between px-4 py-3 transition-colors hover:bg-muted/40 ${isCurrentUser ? "bg-primary/5 border-l-2 border-primary" : ""}`}>
      <div className="flex items-center gap-3">
        <div className="w-8 flex justify-center">{rankEl}</div>
        <Link href={`/profile/${entry.userId}`}>
          <div className="relative">
            <Avatar className={`h-9 w-9 cursor-pointer ring-2 ${isCurrentUser ? "ring-primary" : "ring-transparent"} hover:ring-primary/40 transition-all`}>
              <AvatarImage src={entry.avatarUrl ?? ""} />
              <AvatarFallback className="bg-primary/10 text-primary font-semibold text-xs">
                {entry.name?.slice(0, 2).toUpperCase() ?? "??"}
              </AvatarFallback>
            </Avatar>
            {CONTRACT_DEPLOYED && isChainVerified && (
              <div className="absolute -bottom-0.5 -right-0.5 h-4 w-4 bg-violet-600 rounded-full flex items-center justify-center border border-background">
                <Shield className="h-2 w-2 text-white" />
              </div>
            )}
          </div>
        </Link>
        <div>
          <div className="flex items-center gap-1.5">
            <Link href={`/profile/${entry.userId}`} className="font-semibold text-sm hover:underline">
              {entry.name ?? "Anonymous"}
            </Link>
            {isCurrentUser && (
              <span className="text-[9px] font-bold text-primary bg-primary/10 px-1 py-0.5 rounded">You</span>
            )}
            {CONTRACT_DEPLOYED && isChainVerified && (
              <span className="inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 border border-violet-200">
                <Link2 className="h-2 w-2" /> Monad
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">@{entry.username}</span>
            {hasStreak && (
              <span className="text-xs text-orange-600 font-medium flex items-center gap-0.5">
                <Flame className="h-3 w-3" /> {entry.currentStreak}d
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-5 text-right">
        <div className="hidden sm:flex flex-col items-center min-w-[44px]">
          <span className="text-[10px] text-muted-foreground font-medium">Posts</span>
          <span className="font-semibold text-sm">{entry.postCount}</span>
        </div>
        <div className="flex flex-col items-center min-w-[64px]">
          <span className="text-[10px] text-muted-foreground font-medium flex items-center gap-0.5">
            {metricIcon} {metricLabel}
          </span>
          <span className="font-bold text-base text-primary">{metricValue.toLocaleString()}</span>
        </div>
      </div>
    </div>
  );
}

// ── Board ────────────────────────────────────────────────────────

function Board({
  sortBy,
  period,
  currentUserId,
}: {
  sortBy: SortBy;
  period: Period;
  currentUserId: number | undefined;
}) {
  const [entries, setEntries] = useState<LeaderEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [stale, setStale] = useState(false);
  const { pendingCount } = useActivityFeed(currentUserId);
  const refreshingRef = useRef(false);

  const load = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setLoading(true);
    setStale(false);
    try {
      const data = await fetchLeaderboard(sortBy, period);
      setEntries(data);
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
      refreshingRef.current = false;
    }
  }, [sortBy, period]);

  // Initial fetch + refetch on sortBy/period change
  useEffect(() => { void load(); }, [load]);

  // Mark stale when there's live activity (new posts/likes)
  useEffect(() => {
    if (pendingCount > 0 && entries !== null && !loading) {
      setStale(true);
    }
  }, [pendingCount]);

  const metricFns: Record<SortBy, (e: LeaderEntry) => { label: string; value: number; icon: React.ReactNode }> = {
    points:      (e) => ({ label: "Points",      value: e.totalPoints,     icon: <Star className="h-3 w-3 text-primary" /> }),
    subscribers: (e) => ({ label: "Subscribers", value: e.subscriberCount, icon: <Users className="h-3 w-3 text-purple-500" /> }),
    engagement:  (e) => ({ label: "Score",       value: e.engagementScore, icon: <Zap className="h-3 w-3 text-orange-500" /> }),
    likes:       (e) => ({ label: "Likes",       value: e.likeCount,       icon: <Heart className="h-3 w-3 text-red-500" /> }),
  };

  const getMetric = metricFns[sortBy];
  const metricLabel = getMetric(({ totalPoints: 0, subscriberCount: 0, engagementScore: 0, likeCount: 0 } as LeaderEntry)).label;

  const top3 = entries?.slice(0, 3) ?? [];
  const rest = entries?.slice(3) ?? [];

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex justify-center items-end gap-3 h-40">
          {[...Array(3)].map((_, i) => (
            <div key={i} className={`flex-1 animate-pulse bg-muted rounded-t-lg ${i === 1 ? "h-28" : i === 0 ? "h-20" : "h-16"}`} />
          ))}
        </div>
        <Card>
          <CardContent className="p-0 divide-y">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="p-4 animate-pulse flex items-center gap-4">
                <div className="h-9 w-9 rounded-full bg-muted" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 bg-muted rounded w-1/3" />
                  <div className="h-2 bg-muted rounded w-1/4" />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!entries || entries.length === 0) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <Trophy className="h-10 w-10 mx-auto mb-3 opacity-30" />
        <p>No rankings yet — be the first to participate!</p>
      </div>
    );
  }

  const podiumOrder = [
    PODIUM_CONFIG.find((p) => p.pos === 2)!,
    PODIUM_CONFIG.find((p) => p.pos === 1)!,
    PODIUM_CONFIG.find((p) => p.pos === 3)!,
  ];

  return (
    <div className="space-y-4">
      {/* Stale refresh bar */}
      {stale && (
        <button
          onClick={() => void load()}
          className="w-full flex items-center justify-center gap-2 text-xs font-medium text-primary bg-primary/5 border border-primary/20 rounded-lg py-2 px-4 hover:bg-primary/10 transition-colors"
        >
          <RotateCcw className="h-3.5 w-3.5 animate-spin-slow" />
          Rankings updated — tap to refresh
        </button>
      )}

      {/* Podium */}
      {top3.length >= 2 && (
        <div className="flex items-end justify-center gap-2 px-4 pt-4">
          {podiumOrder.map((cfg) => {
            const entry = entries.find((e) => e.rank === cfg.pos);
            const metric = entry ? getMetric(entry) : { value: 0, label: metricLabel };
            return (
              <PodiumSlot
                key={cfg.pos}
                entry={entry}
                pos={cfg.pos}
                height={cfg.height}
                bg={cfg.bg}
                label={cfg.label}
                emoji={cfg.emoji}
                textColor={cfg.textColor}
                metricValue={metric.value}
                metricLabel={metric.label}
                isCurrentUser={!!(entry && currentUserId && entry.userId === currentUserId)}
              />
            );
          })}
        </div>
      )}

      {/* Full list */}
      <Card>
        <CardContent className="p-0">
          <div className="divide-y">
            {entries.map((entry) => {
              const m = getMetric(entry);
              return (
                <LeaderRow
                  key={entry.userId}
                  entry={entry}
                  metricValue={m.value}
                  metricLabel={m.label}
                  metricIcon={m.icon}
                  isCurrentUser={!!(currentUserId && entry.userId === currentUserId)}
                />
              );
            })}
          </div>
          {rest.length > 0 && (
            <div className="px-4 py-3 text-xs text-muted-foreground text-center border-t">
              Showing top {entries.length} users · Keep posting to climb the ranks
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────

export default function Leaderboard() {
  const { data: chainUserCount } = useContractUserCount();
  const { user } = useUser();
  const [period, setPeriod] = useState<Period>("alltime");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-yellow-100 text-yellow-600 rounded-lg">
            <Trophy className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Leaderboard</h1>
            <p className="text-muted-foreground text-sm">Top community members across all metrics</p>
          </div>
        </div>
        {CONTRACT_DEPLOYED && chainUserCount !== undefined && (
          <div className="flex flex-col items-end">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-violet-700 bg-violet-50 border border-violet-200 rounded-full px-3 py-1">
              <Link2 className="h-3 w-3" />
              {Number(chainUserCount).toLocaleString()} on Monad
            </div>
            <p className="text-[10px] text-muted-foreground mt-1 text-right">
              <Shield className="h-2.5 w-2.5 inline mr-0.5" /> = verified on-chain
            </p>
          </div>
        )}
      </div>

      {/* Period toggle */}
      <div className="flex items-center gap-2">
        <Button
          variant={period === "alltime" ? "default" : "outline"}
          size="sm"
          onClick={() => setPeriod("alltime")}
          className="h-8 text-xs"
        >
          All Time
        </Button>
        <Button
          variant={period === "weekly" ? "default" : "outline"}
          size="sm"
          onClick={() => setPeriod("weekly")}
          className="h-8 text-xs"
        >
          This Week
        </Button>
      </div>

      {/* Legend */}
      {CONTRACT_DEPLOYED && (
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <div className="h-4 w-4 bg-violet-600 rounded-full flex items-center justify-center">
              <Shield className="h-2 w-2 text-white" />
            </div>
            Registered on Monad Mainnet
          </div>
          <div className="flex items-center gap-1.5">
            <Flame className="h-4 w-4 text-orange-500" />
            Active streak
          </div>
        </div>
      )}

      {/* Sort tabs */}
      <Tabs defaultValue="points">
        <TabsList className="w-full">
          <TabsTrigger value="points" className="flex-1 gap-1">
            <Star className="h-3.5 w-3.5" /> Points
          </TabsTrigger>
          <TabsTrigger value="likes" className="flex-1 gap-1">
            <Heart className="h-3.5 w-3.5" /> Likes
          </TabsTrigger>
          <TabsTrigger value="subscribers" className="flex-1 gap-1">
            <Users className="h-3.5 w-3.5" /> Subs
          </TabsTrigger>
          <TabsTrigger value="engagement" className="flex-1 gap-1">
            <Zap className="h-3.5 w-3.5" /> Score
          </TabsTrigger>
        </TabsList>

        {(["points", "likes", "subscribers", "engagement"] as SortBy[]).map((tab) => (
          <TabsContent key={tab} value={tab} className="mt-4">
            <Board sortBy={tab} period={period} currentUserId={user?.id} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
