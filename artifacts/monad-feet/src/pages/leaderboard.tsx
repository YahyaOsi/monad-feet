import { useState, useEffect, useCallback, useRef } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Trophy, Users, Star, Link2, Shield, Flame, RotateCcw, TrendingUp } from "lucide-react";
import { useContractUserCount } from "@/lib/useOnChain";
import { CONTRACT_DEPLOYED } from "@/lib/contract";
import { useUser } from "@/context/UserContext";
import { useActivityFeed } from "@/hooks/usePresence";
import { Button } from "@/components/ui/button";
import { loadLeaderboard, type LeaderEntry, type LeaderboardPeriod as Period } from "@/lib/leaderboard";

interface MyRank {
  rank: number;
  totalUsers: number;
  totalPoints: number;
  currentStreak: number;
  subscriberCount: number;
  avatarUrl?: string | null;
  name?: string | null;
  username?: string | null;
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function fetchMyRank(period: Period): Promise<MyRank | null> {
  const wallet = localStorage.getItem("mf_wallet_address") ?? "";
  if (!wallet) return null;
  const res = await fetch(`${BASE}/api/leaderboard/me?period=${period}`, {
    headers: { "x-wallet-address": wallet },
  });
  if (!res.ok) return null;
  return res.json() as Promise<MyRank>;
}

async function fetchLeaderboard(period: Period): Promise<LeaderEntry[]> {
  return loadLeaderboard(BASE, period);
}

// ── My Rank Card ─────────────────────────────────────────────────

function rankLabel(rank: number): { emoji: string; label: string; color: string; bg: string; border: string } {
  if (rank === 1) return { emoji: "1st", label: "1st Place",   color: "text-yellow-700 dark:text-yellow-300", bg: "bg-yellow-50 dark:bg-yellow-500/15",  border: "border-yellow-300 dark:border-yellow-400/40" };
  if (rank === 2) return { emoji: "2nd", label: "2nd Place",   color: "text-slate-600 dark:text-slate-200",  bg: "bg-slate-50 dark:bg-slate-400/15",   border: "border-slate-300 dark:border-slate-300/40" };
  if (rank === 3) return { emoji: "3rd", label: "3rd Place",   color: "text-amber-700 dark:text-orange-300",  bg: "bg-amber-50 dark:bg-orange-500/15",   border: "border-amber-300 dark:border-orange-400/40" };
  if (rank <= 10) return { emoji: "Top", label: "Top 10",      color: "text-violet-700 dark:text-violet-200", bg: "bg-violet-50 dark:bg-violet-500/20",  border: "border-violet-300 dark:border-violet-400/40" };
  if (rank <= 25) return { emoji: "Top", label: "Top 25",      color: "text-primary",    bg: "bg-primary/5",  border: "border-primary/30" };
  if (rank <= 50) return { emoji: "Top", label: "Top 50",      color: "text-orange-700", bg: "bg-orange-50",  border: "border-orange-300" };
  return                 { emoji: "#", label: `Rank #${rank}`, color: "text-foreground", bg: "bg-muted/40",  border: "border-border" };
}

function rankMessage(rank: number, totalUsers: number): string {
  const pct = Math.round((rank / totalUsers) * 100);
  if (rank === 1) return "You're #1, keep that streak alive!";
  if (rank <= 3)  return `Incredible, you're in the top 3 out of ${totalUsers.toLocaleString()} members!`;
  if (rank <= 10) return `You're in the elite top 10. Keep posting and checking in!`;
  if (rank <= 25) return `Top 25 out of ${totalUsers.toLocaleString()}, just ${rank - 1} spots from the top!`;
  return `You're in the top ${pct}% of all ${totalUsers.toLocaleString()} members. Keep earning points!`;
}

function MyRankCard({ myRank, period }: { myRank: MyRank; period: Period }) {
  const { emoji, label, color, bg, border } = rankLabel(myRank.rank);
  const ordinal = myRank.rank === 1 ? "1st" : myRank.rank === 2 ? "2nd" : myRank.rank === 3 ? "3rd" : `${myRank.rank}th`;

  return (
    <Card className={`${bg} border-2 ${border} shadow-sm`}>
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className={`text-sm font-semibold flex items-center gap-2 ${color}`}>
          <TrendingUp className="h-4 w-4" />
          Your Ranking
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <div className="flex flex-wrap items-center gap-3 sm:gap-4 min-w-0">
          {/* Avatar */}
          <Avatar className={`h-14 w-14 border-4 ${border} shadow-md flex-shrink-0`}>
            <AvatarImage src={myRank.avatarUrl ?? ""} />
            <AvatarFallback className="bg-primary/10 text-primary font-bold text-base">
              {myRank.name?.slice(0, 2).toUpperCase() ?? "??"}
            </AvatarFallback>
          </Avatar>

          {/* Rank badge + name */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-2xl">{emoji}</span>
              <span className={`text-2xl font-black ${color}`}>{ordinal}</span>
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${color} ${bg} ${border}`}>
                {label}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 break-words [overflow-wrap:anywhere]">
              @{myRank.username} · out of {myRank.totalUsers.toLocaleString()} members
            </p>
          </div>

          {/* Stats */}
          <div className="flex flex-wrap gap-3 w-full sm:w-auto min-w-0">
            <div className="text-center">
              <div className="flex items-center gap-0.5 justify-center mb-0.5">
                <Star className="h-3 w-3 text-primary" />
                <span className="text-[10px] font-semibold text-muted-foreground uppercase">Points</span>
              </div>
              <span className={`text-xl font-black ${color}`}>{myRank.totalPoints.toLocaleString()}</span>
            </div>
            <div className="w-px bg-border" />
            <div className="text-center">
              <div className="flex items-center gap-0.5 justify-center mb-0.5">
                <Users className="h-3 w-3 text-purple-500" />
                <span className="text-[10px] font-semibold text-muted-foreground uppercase">Subs</span>
              </div>
              <span className="text-xl font-black text-purple-600">{myRank.subscriberCount}</span>
            </div>
            {myRank.currentStreak > 0 && (
              <>
                <div className="w-px bg-border" />
                <div className="text-center">
                  <div className="flex items-center gap-0.5 justify-center mb-0.5">
                    <Flame className="h-3 w-3 text-orange-500" />
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase">Streak</span>
                  </div>
                  <span className="text-xl font-black text-orange-500">{myRank.currentStreak}d</span>
                </div>
              </>
            )}
          </div>
        </div>

        <p className={`text-xs mt-3 font-medium ${color} bg-white/60 dark:bg-white/5 rounded-lg px-3 py-2 border ${border}`}>
          {rankMessage(myRank.rank, myRank.totalUsers)}
        </p>
        <p className="text-xs text-muted-foreground mt-2">Points measure current app activities, not tokens. Rank is a leaderboard position, not a confirmed reward. Future token plans do not promise a reward, date or conversion rate.</p>

        {period === "weekly" && (
          <p className="text-[10px] text-muted-foreground mt-2 text-center">
            * Points are all time; activity in the selected period breaks ties.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ── Rank styling ─────────────────────────────────────────────────

function getRankStyle(rank: number): { row: string; badge: string } {
  if (rank === 1) return {
    row: "bg-yellow-50/80 dark:bg-yellow-500/10 border-l-4 border-yellow-400 dark:border-yellow-400",
    badge: "text-yellow-700 bg-yellow-100 border border-yellow-300 dark:text-yellow-200 dark:bg-yellow-500/20 dark:border-yellow-400/50",
  };
  if (rank === 2) return {
    row: "bg-slate-50/80 dark:bg-slate-300/10 border-l-4 border-slate-400 dark:border-slate-300",
    badge: "text-slate-600 bg-slate-100 border border-slate-300 dark:text-slate-100 dark:bg-slate-300/20 dark:border-slate-300/50",
  };
  if (rank === 3) return {
    row: "bg-amber-50/80 dark:bg-orange-500/10 border-l-4 border-amber-500 dark:border-orange-400",
    badge: "text-amber-700 bg-amber-100 border border-amber-300 dark:text-orange-200 dark:bg-orange-500/20 dark:border-orange-400/50",
  };
  if (rank <= 10) return {
    row: "bg-violet-50/40 dark:bg-violet-500/10 border-l-4 border-violet-300 dark:border-violet-400/70",
    badge: "text-violet-600 bg-violet-100 border border-violet-200 dark:text-violet-100 dark:bg-violet-500/25 dark:border-violet-400/50",
  };
  return {
    row: "hover:bg-muted/40",
    badge: "text-muted-foreground bg-muted border border-transparent",
  };
}

function rankEmoji(rank: number) {
  if (rank === 1) return "1st";
  if (rank === 2) return "2nd";
  if (rank === 3) return "3rd";
  return null;
}

// ── Podium ────────────────────────────────────────────────────────

const PODIUM_CONFIG = [
  { pos: 2, height: "h-20", ring: "ring-slate-400",  label: "2nd", emoji: "2nd", textColor: "text-slate-500",  bg: "bg-slate-50  border-slate-200" },
  { pos: 1, height: "h-28", ring: "ring-yellow-400", label: "1st", emoji: "1st", textColor: "text-yellow-600", bg: "bg-yellow-50 border-yellow-300" },
  { pos: 3, height: "h-16", ring: "ring-amber-500",  label: "3rd", emoji: "3rd", textColor: "text-amber-700",  bg: "bg-amber-50  border-amber-300" },
];

function PodiumSlot({
  entry, pos, height, ring, label, emoji, textColor, bg, isCurrentUser,
}: {
  entry: LeaderEntry | undefined;
  pos: number; height: string; ring: string; label: string;
  emoji: string; textColor: string; bg: string; isCurrentUser: boolean;
}) {
  const placeholder = (
    <div className="flex flex-col items-center gap-2 flex-1">
      <div className="h-14 w-14 rounded-full bg-muted border-2 border-dashed border-muted-foreground/20 flex items-center justify-center">
        <span className="text-xl">{emoji}</span>
      </div>
      <div className={`w-full ${height} ${bg} border-2 rounded-t-xl flex items-center justify-center`}>
        <span className={`text-xs font-bold ${textColor}`}>{label}</span>
      </div>
    </div>
  );

  if (!entry) return placeholder;

  return (
    <div className="flex flex-col items-center gap-2 flex-1">
      <Link href={`/profile/${entry.userId}`}>
        <div className="relative">
          <Avatar className={`h-14 w-14 cursor-pointer border-4 ring-2 ${ring} ${isCurrentUser ? "border-primary" : "border-background"} shadow-md`}>
            <AvatarImage src={entry.avatarUrl ?? ""} />
            <AvatarFallback className="bg-primary/10 text-primary font-bold text-base">
              {entry.name?.slice(0, 2).toUpperCase() ?? "??"}
            </AvatarFallback>
          </Avatar>
          <span className="absolute -bottom-1 -right-1 text-base">{emoji}</span>
          {CONTRACT_DEPLOYED && entry.registrationTxHash && (
            <div className="absolute -top-1 -left-1 h-4 w-4 bg-violet-600 rounded-full flex items-center justify-center border border-white">
              <Shield className="h-2 w-2 text-white" />
            </div>
          )}
        </div>
      </Link>
      <div className="text-center">
        <p className="text-xs font-semibold leading-tight break-words [overflow-wrap:anywhere] max-w-full">
          {entry.name ?? "Anonymous"}
        </p>
        {isCurrentUser && (
          <span className="text-[9px] font-bold text-primary bg-primary/10 px-1 rounded">You</span>
        )}
      </div>
      <div className={`w-full ${height} ${bg} border-2 rounded-t-xl flex flex-col items-center justify-center gap-1 shadow-sm px-1`}>
        <div className="flex flex-col items-center">
          <span className={`text-base font-bold ${textColor}`}>{entry.totalPoints.toLocaleString()}</span>
          <span className="text-[9px] text-muted-foreground font-medium uppercase tracking-wide leading-none">pts</span>
        </div>
        <div className="flex items-center gap-1 text-muted-foreground">
          <Users className="h-2.5 w-2.5" />
          <span className="text-[10px] font-semibold">{entry.subscriberCount}</span>
        </div>
      </div>
    </div>
  );
}

// ── Row ───────────────────────────────────────────────────────────

function LeaderRow({ entry, isCurrentUser }: { entry: LeaderEntry; isCurrentUser: boolean }) {
  const style = getRankStyle(entry.rank);
  const emojiStr = rankEmoji(entry.rank);

  return (
    <div className={`flex items-center justify-between px-4 py-3 transition-colors ${style.row} ${isCurrentUser && entry.rank > 10 ? "border-l-4 !border-l-primary bg-primary/5" : ""}`}>
      {/* Rank + avatar + name */}
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-8 flex-shrink-0 flex justify-center">
          {emojiStr
            ? <span className="text-xl">{emojiStr}</span>
            : <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${style.badge}`}>#{entry.rank}</span>
          }
        </div>
        <Link href={`/profile/${entry.userId}`}>
          <div className="relative flex-shrink-0">
            <Avatar className={`h-9 w-9 cursor-pointer ring-2 ${isCurrentUser ? "ring-primary" : entry.rank <= 3 ? "ring-yellow-300 dark:ring-yellow-400/60" : entry.rank <= 10 ? "ring-violet-300 dark:ring-violet-400/60" : "ring-transparent"} hover:ring-primary/40 transition-all`}>
              <AvatarImage src={entry.avatarUrl ?? ""} />
              <AvatarFallback className="bg-primary/10 text-primary font-semibold text-xs">
                {entry.name?.slice(0, 2).toUpperCase() ?? "??"}
              </AvatarFallback>
            </Avatar>
            {CONTRACT_DEPLOYED && entry.registrationTxHash && (
              <div className="absolute -bottom-0.5 -right-0.5 h-4 w-4 bg-violet-600 rounded-full flex items-center justify-center border border-background">
                <Shield className="h-2 w-2 text-white" />
              </div>
            )}
          </div>
        </Link>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <Link href={`/profile/${entry.userId}`} className="font-semibold text-sm hover:underline break-words [overflow-wrap:anywhere]">
              {entry.name ?? "Anonymous"}
            </Link>
            {isCurrentUser && (
              <span className="text-[9px] font-bold text-primary bg-primary/10 px-1 py-0.5 rounded flex-shrink-0">You</span>
            )}
            {entry.rank <= 10 && (
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${style.badge} flex-shrink-0`}>
                Top {entry.rank <= 3 ? "3" : "10"}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs text-muted-foreground break-all">@{entry.username}</span>
            {entry.currentStreak > 0 && (
              <span className="text-xs text-orange-600 font-medium flex items-center gap-0.5 flex-shrink-0">
                <Flame className="h-3 w-3" />{entry.currentStreak}d
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Points + Subscriptions */}
      <div className="flex items-center gap-1 flex-shrink-0 ml-2">
        {/* Points column */}
        <div className="flex flex-col items-center min-w-[52px] text-right">
          <span className="text-[10px] text-muted-foreground font-medium flex items-center gap-0.5 justify-end">
            <Star className="h-2.5 w-2.5 text-primary" /> Points
          </span>
          <span className="font-bold text-base text-primary leading-tight">
            {entry.totalPoints.toLocaleString()}
          </span>
        </div>
        {/* Divider */}
        <div className="w-px h-8 bg-border mx-2" />
        {/* Subscriptions column */}
        <div className="flex flex-col items-center min-w-[40px] text-right">
          <span className="text-[10px] text-muted-foreground font-medium flex items-center gap-0.5 justify-end">
            <Users className="h-2.5 w-2.5 text-purple-500" /> Subs
          </span>
          <span className="font-bold text-base text-purple-600 leading-tight">
            {entry.subscriberCount}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Board ─────────────────────────────────────────────────────────

function Board({ period, currentUserId }: { period: Period; currentUserId: number | undefined }) {
  const [entries, setEntries] = useState<LeaderEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState("");
  const { pendingCount } = useActivityFeed(currentUserId);
  const refreshingRef = useRef(false);

  const load = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setLoading(true);
    setStale(false);
    setError("");
    try {
      const data = await fetchLeaderboard(period);
      setEntries(data);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not load rankings.");
    } finally {
      setLoading(false);
      refreshingRef.current = false;
    }
  }, [period]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (pendingCount > 0 && entries !== null && !loading) setStale(true);
  }, [pendingCount, entries, loading]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex justify-center items-end gap-3 h-44">
          {[...Array(3)].map((_, i) => (
            <div key={i} className={`flex-1 animate-pulse bg-muted rounded-t-xl ${i === 1 ? "h-28" : i === 0 ? "h-20" : "h-16"}`} />
          ))}
        </div>
        <Card>
          <CardContent className="p-0 divide-y">
            {[...Array(7)].map((_, i) => (
              <div key={i} className="p-4 animate-pulse flex items-center gap-4">
                <div className="h-9 w-9 rounded-full bg-muted flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 bg-muted rounded w-1/3" />
                  <div className="h-2 bg-muted rounded w-1/4" />
                </div>
                <div className="flex gap-4">
                  <div className="h-8 w-12 bg-muted rounded" />
                  <div className="h-8 w-10 bg-muted rounded" />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return <div role="alert" className="text-center py-12 space-y-3">
      <p className="text-destructive">{error}</p>
      <Button variant="outline" onClick={() => void load()}>Try again</Button>
    </div>;
  }

  if (!entries || entries.length === 0) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <Trophy className="h-10 w-10 mx-auto mb-3 opacity-30" />
        <p>No rankings yet, be the first to participate!</p>
      </div>
    );
  }

  const top3 = entries.slice(0, 3);
  const podiumOrder = [
    PODIUM_CONFIG.find((p) => p.pos === 2)!,
    PODIUM_CONFIG.find((p) => p.pos === 1)!,
    PODIUM_CONFIG.find((p) => p.pos === 3)!,
  ];

  return (
    <div className="space-y-4">
      {stale && (
        <button
          onClick={() => void load()}
          className="w-full flex items-center justify-center gap-2 text-xs font-medium text-primary bg-primary/5 border border-primary/20 rounded-lg py-2 px-4 hover:bg-primary/10 transition-colors"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Rankings updated, tap to refresh
        </button>
      )}

      {/* Podium */}
      {top3.length >= 2 && (
        <div className="flex items-end justify-center gap-2 px-4 pt-4">
          {podiumOrder.map((cfg) => {
            const entry = entries.find((e) => e.rank === cfg.pos);
            return (
              <PodiumSlot
                key={cfg.pos}
                entry={entry}
                pos={cfg.pos}
                height={cfg.height}
                ring={cfg.ring}
                label={cfg.label}
                emoji={cfg.emoji}
                textColor={cfg.textColor}
                bg={cfg.bg}
                isCurrentUser={!!(entry && currentUserId && entry.userId === currentUserId)}
              />
            );
          })}
        </div>
      )}

      {/* Column headers */}
      <Card>
        <CardContent className="p-0">
          {/* Header row */}
          <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Member
            </span>
            <div className="flex items-center gap-1 flex-shrink-0">
              <div className="flex items-center gap-1 min-w-[52px] justify-end">
                <Star className="h-3 w-3 text-primary" />
                <span className="text-xs font-semibold text-primary uppercase tracking-wide">Points</span>
              </div>
              <div className="w-px h-4 bg-border mx-2" />
              <div className="flex items-center gap-1 min-w-[40px] justify-end">
                <Users className="h-3 w-3 text-purple-500" />
                <span className="text-xs font-semibold text-purple-600 uppercase tracking-wide">Subs</span>
              </div>
            </div>
          </div>

          {/* Rows */}
          <div className="divide-y">
            {entries.map((entry) => (
              <LeaderRow
                key={entry.userId}
                entry={entry}
                isCurrentUser={!!(currentUserId && entry.userId === currentUserId)}
              />
            ))}
          </div>

          {/* Legend at bottom */}
          <div className="px-4 py-3 border-t bg-muted/20 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-sm bg-yellow-200 border border-yellow-400" />
              <span>Top 3</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-sm bg-violet-100 border border-violet-300" />
              <span>Top 10</span>
            </div>
            {CONTRACT_DEPLOYED && (
              <div className="flex items-center gap-1.5">
                <div className="h-3 w-3 bg-violet-600 rounded-full flex items-center justify-center">
                  <Shield className="h-2 w-2 text-white" />
                </div>
                <span>Monad verified</span>
              </div>
            )}
            <span className="ml-auto">Showing top {entries.length} · sorted by points</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────

export default function Leaderboard() {
  const { data: chainUserCount } = useContractUserCount();
  const { user } = useUser();
  const [period, setPeriod] = useState<Period>("alltime");
  const [myRank, setMyRank] = useState<MyRank | null>(null);
  const [rankLoading, setRankLoading] = useState(false);

  useEffect(() => {
    let active = true;
    if (!user) {
      setMyRank(null);
      setRankLoading(false);
      return;
    }
    setRankLoading(true);
    fetchMyRank(period)
      .then((r) => { if (active) setMyRank(r); })
      .catch(() => { if (active) setMyRank(null); })
      .finally(() => { if (active) setRankLoading(false); });
    return () => { active = false; };
  }, [user?.id, period]);

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
            <p className="text-muted-foreground text-sm">Top members ranked by streak points</p>
          </div>
        </div>
        {CONTRACT_DEPLOYED && chainUserCount !== undefined && (
          <div className="flex flex-col items-end">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-violet-700 bg-violet-50 border border-violet-200 rounded-full px-3 py-1">
              <Link2 className="h-3 w-3" />
              {Number(chainUserCount).toLocaleString()} on Monad
            </div>
          </div>
        )}
      </div>

      {/* My Rank Card, only for logged-in users */}
      {user && (
        rankLoading ? (
          <Card className="border-2 border-border animate-pulse">
            <CardContent className="p-4">
              <div className="flex items-center gap-4">
                <div className="h-14 w-14 rounded-full bg-muted flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-5 bg-muted rounded w-1/3" />
                  <div className="h-3 bg-muted rounded w-1/4" />
                </div>
                <div className="flex gap-4">
                  <div className="h-10 w-14 bg-muted rounded" />
                  <div className="h-10 w-12 bg-muted rounded" />
                </div>
              </div>
            </CardContent>
          </Card>
        ) : myRank ? (
          <MyRankCard myRank={myRank} period={period} />
        ) : null
      )}

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

      {period === "weekly" && <p className="text-xs text-muted-foreground">Posts and likes cover the last 7 days. Points show each member's total earned points.</p>}
      <Board key={`${period}:${user?.id ?? "guest"}`} period={period} currentUserId={user?.id} />
    </div>
  );
}
