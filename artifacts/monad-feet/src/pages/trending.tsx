import { useState, useEffect, useRef, useCallback } from "react";
import { useGetTrending } from "@workspace/api-client-react";
import { useActivityFeed } from "@/hooks/usePresence";
import { useUser } from "@/context/UserContext";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Link } from "wouter";
import {
  Flame, TrendingUp, TrendingDown, Minus, Heart, Clock,
  Zap, ChevronRight, RefreshCw
} from "lucide-react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { getGetTrendingQueryKey } from "@workspace/api-client-react";
import { formatDistanceToNow } from "date-fns";
import type { TrendingPost } from "@workspace/api-client-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// Re-fetch every 30s in the background
const REFETCH_INTERVAL = 30_000;

function getVelocityLabel(velocity: number, recentLikes: number) {
  if (velocity >= 5 || recentLikes >= 20) return { label: "HOT", color: "text-orange-600 bg-orange-50 border-orange-200", icon: Flame };
  if (velocity >= 1 || recentLikes >= 5) return { label: "RISING", color: "text-emerald-600 bg-emerald-50 border-emerald-200", icon: TrendingUp };
  return { label: "STEADY", color: "text-slate-500 bg-slate-50 border-slate-200", icon: Minus };
}

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return <span className="text-2xl leading-none" title="#1">🥇</span>;
  if (rank === 2) return <span className="text-2xl leading-none" title="#2">🥈</span>;
  if (rank === 3) return <span className="text-2xl leading-none" title="#3">🥉</span>;
  return (
    <span className="text-sm font-bold text-muted-foreground w-6 text-center tabular-nums">
      #{rank}
    </span>
  );
}

type RankChange = "up" | "down" | "same" | "new";

function RankChangeIndicator({ change, delta }: { change: RankChange; delta: number }) {
  if (change === "new") return (
    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">NEW</span>
  );
  if (change === "up") return (
    <span className="flex items-center gap-0.5 text-[10px] font-bold text-emerald-600">
      <TrendingUp className="h-3 w-3" />+{delta}
    </span>
  );
  if (change === "down") return (
    <span className="flex items-center gap-0.5 text-[10px] font-bold text-rose-500">
      <TrendingDown className="h-3 w-3" />-{delta}
    </span>
  );
  return <span className="text-[10px] text-muted-foreground"><Minus className="h-3 w-3" /></span>;
}

function VelocityBar({ velocity, max }: { velocity: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (velocity / max) * 100) : 0;
  return (
    <div className="h-1 w-full bg-muted rounded-full overflow-hidden">
      <div
        className="h-full bg-gradient-to-r from-primary/60 to-primary rounded-full transition-all duration-700"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export default function Trending() {
  const { user } = useUser();
  const queryClient = useQueryClient();
  const { data, isLoading, dataUpdatedAt } = useGetTrending({
    query: { refetchInterval: REFETCH_INTERVAL, queryKey: [] as any },
  });

  // Live like-count overrides from WebSocket
  const { likeUpdates, anchorUpdates } = useActivityFeed(user?.id);

  // Track previous rank positions for change indicators
  const prevRankMapRef = useRef<Map<number, number>>(new Map());

  // Base posts from API
  const basePosts = data?.posts ?? [];

  // Apply live like-count overrides, then re-sort by velocity-adjusted score
  const livePosts: (TrendingPost & { liveScore: number })[] = basePosts.map((p) => {
    const liveLikes = likeUpdates.has(p.id) ? (likeUpdates.get(p.id) ?? p.likeCount) : p.likeCount;
    const extraLikes = Math.max(0, liveLikes - p.likeCount);
    // Re-estimate velocity by adding extra likes to recentLikes
    const liveRecentLikes = p.recentLikes + extraLikes;
    const ageHours = (Date.now() - new Date(p.createdAt).getTime()) / 3_600_000;
    const liveScore = liveRecentLikes / Math.max(1.0, 1.0 + 0.3 * ageHours);
    const liveTxHash = anchorUpdates.has(p.id) ? (anchorUpdates.get(p.id) ?? p.onChainTxHash) : p.onChainTxHash;
    return {
      ...p,
      likeCount: liveLikes,
      recentLikes: liveRecentLikes,
      onChainTxHash: liveTxHash ?? null,
      liveScore,
    };
  });

  // Re-rank in real time
  const ranked = [...livePosts].sort((a, b) => b.liveScore - a.liveScore).map((p, i) => ({
    ...p,
    liveRank: i + 1,
  }));

  // Compute rank changes vs previous snapshot
  const currentRankMap = new Map(ranked.map((p) => [p.id, p.liveRank]));
  const changes = new Map<number, { change: RankChange; delta: number }>();
  for (const p of ranked) {
    const prev = prevRankMapRef.current.get(p.id);
    if (prev === undefined) {
      changes.set(p.id, { change: "new", delta: 0 });
    } else if (prev < p.liveRank) {
      changes.set(p.id, { change: "down", delta: p.liveRank - prev });
    } else if (prev > p.liveRank) {
      changes.set(p.id, { change: "up", delta: prev - p.liveRank });
    } else {
      changes.set(p.id, { change: "same", delta: 0 });
    }
  }

  // Snapshot ranks whenever the list stabilises (after WS updates settle)
  useEffect(() => {
    if (ranked.length === 0) return;
    const t = setTimeout(() => {
      prevRankMapRef.current = currentRankMap;
    }, 1_500);
    return () => clearTimeout(t);
  }, [JSON.stringify(ranked.map((p) => p.id))]);

  const maxVelocity = ranked[0]?.liveScore ?? 1;

  const lastUpdated = dataUpdatedAt ? formatDistanceToNow(new Date(dataUpdatedAt), { addSuffix: true }) : null;

  const handleRefresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: getGetTrendingQueryKey() });
  }, [queryClient]);

  return (
    <div className="space-y-6 pb-20">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Flame className="h-7 w-7 text-orange-500" />
            Trending
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Ranked by like velocity — updates live as posts get liked
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <button
            onClick={handleRefresh}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <RefreshCw className="h-3 w-3" /> Refresh
          </button>
          {lastUpdated && (
            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
              <Clock className="h-2.5 w-2.5" /> Updated {lastUpdated}
            </span>
          )}
        </div>
      </div>

      {/* Live badge */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full">
          <span className="relative flex h-1.5 w-1.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
          </span>
          Live rank updates
        </div>
        <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <Zap className="h-3 w-3 text-yellow-500" />
          Like a post to see it climb
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 flex-wrap">
        {[
          { label: "HOT", color: "text-orange-600 bg-orange-50 border-orange-200", desc: "≥5 likes/hr" },
          { label: "RISING", color: "text-emerald-600 bg-emerald-50 border-emerald-200", desc: "≥1 like/hr" },
          { label: "STEADY", color: "text-slate-500 bg-slate-50 border-slate-200", desc: "Cooling off" },
        ].map(({ label, color, desc }) => (
          <div key={label} className="flex items-center gap-1.5 text-[11px]">
            <span className={`px-1.5 py-0.5 rounded-full border font-bold text-[10px] ${color}`}>{label}</span>
            <span className="text-muted-foreground">{desc}</span>
          </div>
        ))}
      </div>

      {/* Trending list */}
      {isLoading ? (
        <div className="space-y-3">
          {[...Array(6)].map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="h-28 p-4" />
            </Card>
          ))}
        </div>
      ) : ranked.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <Flame className="h-12 w-12 mx-auto mb-3 opacity-20" />
          <p className="font-medium">No trending posts yet.</p>
          <p className="text-sm mt-1">Posts from the last 7 days will appear here.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {ranked.map((post) => {
            const velInfo = getVelocityLabel(post.liveScore, post.recentLikes);
            const VelIcon = velInfo.icon;
            const change = changes.get(post.id) ?? { change: "same" as RankChange, delta: 0 };
            const initials = (post.authorName ?? post.authorUsername ?? "?")
              .split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();

            return (
              <Link href={`/post/${post.id}`} key={post.id}>
                <Card className="hover:shadow-md transition-all duration-200 hover:border-primary/30 cursor-pointer group">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-4">
                      {/* Rank */}
                      <div className="flex flex-col items-center gap-1 pt-0.5 min-w-[32px]">
                        <RankBadge rank={post.liveRank} />
                        <RankChangeIndicator change={change.change} delta={change.delta} />
                      </div>

                      {/* Image thumbnail */}
                      {post.imageUrl && (
                        <div className="flex-shrink-0 w-16 h-16 rounded-lg overflow-hidden bg-muted">
                          <img
                            src={post.imageUrl.startsWith("http") ? post.imageUrl : `${BASE}${post.imageUrl.startsWith("/") ? "" : "/"}${post.imageUrl}`}
                            alt=""
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                          />
                        </div>
                      )}

                      {/* Content */}
                      <div className="flex-1 min-w-0 space-y-2">
                        {/* Author row */}
                        <div className="flex items-center gap-2">
                          <Avatar className="h-6 w-6 flex-shrink-0">
                            <AvatarImage src={post.authorAvatarUrl ?? undefined} />
                            <AvatarFallback className="text-[10px]">{initials}</AvatarFallback>
                          </Avatar>
                          <span className="text-sm font-medium truncate">
                            {post.authorName ?? post.authorUsername ?? "Unknown"}
                          </span>
                          {post.authorUsername && (
                            <span className="text-xs text-muted-foreground truncate">@{post.authorUsername}</span>
                          )}
                          {post.onChainTxHash && (
                            <span className="ml-auto flex-shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 border border-violet-200">
                              ⛓ On-chain
                            </span>
                          )}
                        </div>

                        {/* Caption */}
                        {post.content && (
                          <p className="text-sm text-muted-foreground line-clamp-1">{post.content}</p>
                        )}

                        {/* Velocity bar */}
                        <VelocityBar velocity={post.liveScore} max={maxVelocity} />

                        {/* Stats row */}
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Heart className="h-3 w-3 text-rose-400 fill-rose-400" />
                            <span className="font-semibold text-foreground tabular-nums">{post.likeCount}</span> likes
                          </span>
                          <span className="flex items-center gap-1 text-[11px]">
                            <Clock className="h-2.5 w-2.5" />
                            <span className="font-semibold text-foreground tabular-nums">{post.recentLikes}</span> in 24h
                          </span>
                          <span className={`ml-auto flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-[10px] font-bold ${velInfo.color}`}>
                            <VelIcon className="h-2.5 w-2.5" />
                            {velInfo.label}
                          </span>
                        </div>
                      </div>

                      <ChevronRight className="h-4 w-4 text-muted-foreground/40 flex-shrink-0 mt-1 group-hover:text-primary/60 transition-colors" />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
