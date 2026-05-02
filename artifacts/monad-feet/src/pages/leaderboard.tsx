import { useState, useEffect } from "react";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Trophy, Medal, Flame, Users, Zap, Star, Link2, Shield } from "lucide-react";
import { useContractUserCount } from "@/lib/useOnChain";
import { CONTRACT_DEPLOYED } from "@/lib/contract";

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

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return <Medal className="h-6 w-6 text-yellow-500" />;
  if (rank === 2) return <Medal className="h-6 w-6 text-slate-400" />;
  if (rank === 3) return <Medal className="h-6 w-6 text-amber-700" />;
  return <span className="text-sm font-bold text-muted-foreground w-6 text-center">#{rank}</span>;
}

function LeaderRow({
  entry,
  metric,
}: {
  entry: LeaderEntry;
  metric: { label: string; value: number; icon: React.ReactNode };
}) {
  const isChainVerified = !!entry.registrationTxHash;
  const hasStreak = entry.currentStreak > 0;

  return (
    <div className="flex items-center justify-between p-4 hover:bg-muted/50 transition-colors">
      <div className="flex items-center gap-4">
        <div className="w-8 flex justify-center">
          <RankBadge rank={entry.rank} />
        </div>
        <Link href={`/profile/${entry.userId}`}>
          <div className="relative">
            <Avatar className="h-10 w-10 cursor-pointer ring-2 ring-transparent hover:ring-primary/30 transition-all">
              <AvatarImage src={entry.avatarUrl ?? ""} />
              <AvatarFallback className="bg-primary/10 text-primary font-semibold text-xs">
                {entry.name?.slice(0, 2).toUpperCase() ?? "??"}
              </AvatarFallback>
            </Avatar>
            {/* Chain verified dot */}
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
        <div className="hidden sm:flex flex-col items-center min-w-[60px]">
          <span className="text-xs text-muted-foreground font-medium">Posts</span>
          <span className="font-semibold text-sm">{entry.postCount}</span>
        </div>
        <div className="flex flex-col items-center min-w-[80px]">
          <span className="text-xs text-muted-foreground font-medium flex items-center gap-1">
            {metric.icon} {metric.label}
          </span>
          <span className="font-bold text-lg text-primary">{metric.value.toLocaleString()}</span>
        </div>
      </div>
    </div>
  );
}

function LeaderList({
  sortBy,
  metric,
}: {
  sortBy: string;
  metric: (e: LeaderEntry) => { label: string; value: number; icon: React.ReactNode };
}) {
  const [entries, setEntries] = useState<LeaderEntry[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`${BASE}/api/leaderboard?sortBy=${sortBy}`)
      .then((r) => r.json())
      .then(setEntries)
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }, [sortBy]);

  return (
    <Card>
      <CardContent className="p-0">
        {loading ? (
          <div className="divide-y">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="p-4 animate-pulse flex items-center gap-4">
                <div className="h-10 w-10 rounded-full bg-muted" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-muted rounded w-1/3" />
                  <div className="h-3 bg-muted rounded w-1/4" />
                </div>
              </div>
            ))}
          </div>
        ) : !entries || entries.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            <Trophy className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p>No rankings yet — be the first to participate!</p>
          </div>
        ) : (
          <div className="divide-y">
            {entries.map((entry) => (
              <LeaderRow key={entry.userId} entry={entry} metric={metric(entry)} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function Leaderboard() {
  const { data: chainUserCount } = useContractUserCount();

  return (
    <div className="space-y-6">
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
              {Number(chainUserCount).toLocaleString()} on Monad Mainnet
            </div>
            <p className="text-[10px] text-muted-foreground mt-1 text-right">
              <Shield className="h-2.5 w-2.5 inline mr-0.5" /> = verified on-chain
            </p>
          </div>
        )}
      </div>

      {/* Legend */}
      {CONTRACT_DEPLOYED && (
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <div className="h-5 w-5 bg-violet-600 rounded-full flex items-center justify-center">
              <Shield className="h-2.5 w-2.5 text-white" />
            </div>
            Registered on Monad Mainnet
          </div>
          <div className="flex items-center gap-1.5">
            <Flame className="h-4 w-4 text-orange-500" />
            Active streak
          </div>
        </div>
      )}

      <Tabs defaultValue="points">
        <TabsList className="w-full">
          <TabsTrigger value="points" className="flex-1 gap-1.5">
            <Star className="h-4 w-4" /> Points
          </TabsTrigger>
          <TabsTrigger value="subscribers" className="flex-1 gap-1.5">
            <Users className="h-4 w-4" /> Subscribers
          </TabsTrigger>
          <TabsTrigger value="engagement" className="flex-1 gap-1.5">
            <Zap className="h-4 w-4" /> Engagement
          </TabsTrigger>
        </TabsList>

        <TabsContent value="points" className="mt-4">
          <p className="text-xs text-muted-foreground mb-3 flex items-center gap-1.5">
            <Star className="h-3 w-3 text-primary" />
            Ranked by total streak points — counts toward future $MFEET airdrop
          </p>
          <LeaderList
            sortBy="points"
            metric={(e) => ({
              label: "Points",
              value: e.totalPoints,
              icon: <Trophy className="h-3 w-3 text-primary" />,
            })}
          />
        </TabsContent>

        <TabsContent value="subscribers" className="mt-4">
          <p className="text-xs text-muted-foreground mb-3 flex items-center gap-1.5">
            <Users className="h-3 w-3 text-purple-500" />
            Ranked by number of active subscribers — creator economy leaders
          </p>
          <LeaderList
            sortBy="subscribers"
            metric={(e) => ({
              label: "Subscribers",
              value: e.subscriberCount,
              icon: <Users className="h-3 w-3 text-purple-500" />,
            })}
          />
        </TabsContent>

        <TabsContent value="engagement" className="mt-4">
          <p className="text-xs text-muted-foreground mb-3 flex items-center gap-1.5">
            <Zap className="h-3 w-3 text-orange-500" />
            Ranked by engagement score (likes + posts × 2)
          </p>
          <LeaderList
            sortBy="engagement"
            metric={(e) => ({
              label: "Score",
              value: e.engagementScore,
              icon: <Zap className="h-3 w-3 text-orange-500" />,
            })}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
