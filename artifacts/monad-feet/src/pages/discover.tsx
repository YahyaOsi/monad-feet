import { useState, useCallback, useRef } from "react";
import { Link } from "wouter";
import { useGetLeaderboard } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Search, Users, Flame, Trophy, Shield, MessageSquare, Heart, Star, Wifi, WifiOff
} from "lucide-react";
import { CONTRACT_DEPLOYED } from "@/lib/contract";
import { usePresence } from "@/hooks/usePresence";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type UserResult = {
  id: number;
  name?: string | null;
  username?: string | null;
  avatarUrl?: string | null;
  bio?: string | null;
  postCount?: number;
  totalLikes?: number;
  currentStreak?: number;
  streakPoints?: number;
  registrationTxHash?: string | null;
  subscriptionPrice?: number | null;
};

export default function Discover() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: leaderboard } = useGetLeaderboard({}, { query: { queryKey: [] as any } });
  const { onlineUsers, onlineCount, isConnected, isOnline } = usePresence();

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim() || q.trim().length < 1) { setResults(null); return; }
    setSearching(true);
    try {
      const wallet = localStorage.getItem("mf_wallet_address") ?? "";
      const res = await fetch(`${BASE}/api/users/search?q=${encodeURIComponent(q.trim())}&limit=20`, {
        headers: { "x-wallet-address": wallet },
      });
      if (!res.ok) { setResults([]); return; }
      const data = await res.json();
      setResults(data as UserResult[]);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value;
    setQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(q), 300);
  };

  const displayUsers: UserResult[] = results !== null
    ? results
    : (leaderboard ?? []).map((e) => ({
        id: e.userId,
        name: e.name,
        username: e.username,
        avatarUrl: e.avatarUrl,
        postCount: (e as { postCount?: number }).postCount ?? 0,
        totalLikes: (e as { likeCount?: number }).likeCount ?? 0,
        currentStreak: e.currentStreak,
        streakPoints: e.totalPoints,
      }));

  return (
    <div className="space-y-6 pb-20">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Discover</h1>
          <p className="text-muted-foreground">Find other members of the Monad Feet community</p>
        </div>
        <div className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-full border ${
          isConnected
            ? "bg-green-50 text-green-700 border-green-200"
            : "bg-muted text-muted-foreground border-transparent"
        }`}>
          {isConnected
            ? <Wifi className="h-3 w-3" />
            : <WifiOff className="h-3 w-3" />}
          {isConnected ? "Live" : "Connecting..."}
        </div>
      </div>

      {/* Online Now panel */}
      {onlineCount > 0 && (
        <Card className="border-green-200 bg-gradient-to-r from-green-50/60 to-emerald-50/40">
          <CardHeader className="pb-3 pt-4 px-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
              </span>
              {onlineCount} member{onlineCount !== 1 ? "s" : ""} online right now
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="flex flex-wrap gap-2">
              {onlineUsers.map((u) => (
                <Link key={u.userId} href={`/profile/${u.userId}`}>
                  <div className="group flex items-center gap-2 bg-background rounded-full pl-1 pr-3 py-1 border border-green-200 hover:border-green-400 hover:shadow-sm transition-all cursor-pointer">
                    <div className="relative">
                      <Avatar className="h-7 w-7">
                        <AvatarImage src={u.avatarUrl ?? ""} />
                        <AvatarFallback className="text-[10px] bg-green-100 text-green-700 font-bold">
                          {u.name?.slice(0, 2).toUpperCase() ?? "??"}
                        </AvatarFallback>
                      </Avatar>
                      <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 bg-green-500 border-2 border-background rounded-full" />
                    </div>
                    <span className="text-xs font-medium group-hover:text-green-700 transition-colors">
                      {u.name ?? u.username ?? `User ${u.userId}`}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Search bar */}
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={query}
          onChange={handleInput}
          placeholder="Search by name or @username…"
          className="pl-10 h-12 text-base"
          autoFocus
        />
        {searching && (
          <div className="absolute right-3.5 top-1/2 -translate-y-1/2">
            <div className="h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>

      {/* Results label */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground font-medium">
          {results !== null
            ? results.length === 0
              ? "No users found"
              : `${results.length} result${results.length !== 1 ? "s" : ""}`
            : `Top ${displayUsers.length} members by streak points`}
        </p>
        {results === null && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Trophy className="h-3 w-3 text-yellow-500" /> Ranked by points
          </div>
        )}
      </div>

      {/* User grid */}
      <div className="grid sm:grid-cols-2 gap-4">
        {displayUsers.map((user) => {
          const online = isOnline(user.id);
          return (
            <Link key={user.id} href={`/profile/${user.id}`}>
              <Card className="hover:shadow-md hover:border-primary/30 transition-all cursor-pointer group">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="relative">
                      <Avatar className="h-12 w-12 flex-shrink-0 ring-2 ring-transparent group-hover:ring-primary/30 transition-all">
                        <AvatarImage src={user.avatarUrl ?? ""} />
                        <AvatarFallback className="bg-primary/10 text-primary font-bold">
                          {user.name?.slice(0, 2).toUpperCase() ?? "??"}
                        </AvatarFallback>
                      </Avatar>
                      {online && (
                        <span className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 bg-green-500 border-2 border-background rounded-full" title="Online now" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                        <span className="font-semibold text-sm truncate">{user.name}</span>
                        {online && (
                          <span className="inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 border border-green-200 flex-shrink-0">
                            <span className="h-1 w-1 rounded-full bg-green-500 animate-pulse" />
                            Online
                          </span>
                        )}
                        {CONTRACT_DEPLOYED && user.registrationTxHash && (
                          <span className="inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 border border-violet-200 flex-shrink-0">
                            <Shield className="h-2 w-2" /> Monad
                          </span>
                        )}
                        {user.subscriptionPrice !== null && user.subscriptionPrice !== undefined && (
                          <Badge variant="secondary" className="text-[9px] px-1.5 py-0 gap-0.5 h-4 bg-amber-100 text-amber-700 border-amber-200">
                            <Star className="h-2 w-2" /> Creator
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">@{user.username}</p>
                      {user.bio && (
                        <p className="text-xs text-foreground/70 mt-1 line-clamp-1">{user.bio}</p>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-4 gap-2 mt-3 pt-3 border-t border-border/50">
                    <div className="text-center">
                      <div className="flex items-center justify-center mb-0.5">
                        <MessageSquare className="h-2.5 w-2.5 text-muted-foreground" />
                      </div>
                      <p className="text-sm font-bold">{user.postCount ?? 0}</p>
                      <p className="text-[10px] text-muted-foreground">posts</p>
                    </div>
                    <div className="text-center">
                      <div className="flex items-center justify-center mb-0.5">
                        <Heart className="h-2.5 w-2.5 text-muted-foreground" />
                      </div>
                      <p className="text-sm font-bold">{user.totalLikes ?? 0}</p>
                      <p className="text-[10px] text-muted-foreground">likes</p>
                    </div>
                    <div className="text-center">
                      <div className="flex items-center justify-center mb-0.5">
                        <Flame className="h-2.5 w-2.5 text-orange-400" />
                      </div>
                      <p className="text-sm font-bold text-orange-500">{user.currentStreak ?? 0}</p>
                      <p className="text-[10px] text-muted-foreground">streak</p>
                    </div>
                    <div className="text-center">
                      <div className="flex items-center justify-center mb-0.5">
                        <Trophy className="h-2.5 w-2.5 text-yellow-400" />
                      </div>
                      <p className="text-sm font-bold text-yellow-600">{user.streakPoints ?? 0}</p>
                      <p className="text-[10px] text-muted-foreground">pts</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>

      {displayUsers.length === 0 && !searching && (
        <div className="text-center py-16 text-muted-foreground">
          <Users className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No members found</p>
        </div>
      )}
    </div>
  );
}
