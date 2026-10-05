import { useState, useEffect, useRef, useCallback } from "react";
import { Link, useLocation } from "wouter";
import { formatDistanceToNow } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Search as SearchIcon, Users, FileText, Flame, Link2,
  Shield, Heart, X, Clock, TrendingUp, Star
} from "lucide-react";
import { CONTRACT_DEPLOYED } from "@/lib/contract";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const RECENT_KEY = "mf_recent_searches";
const MAX_RECENT = 8;

type UserResult = {
  id: number;
  name: string | null;
  username: string | null;
  avatarUrl: string | null;
  bio: string | null;
  registrationTxHash: string | null;
  currentStreak: number;
  subscriberCount: number;
  postCount: number;
};

type PostResult = {
  id: number;
  content: string | null;
  imageUrl: string | null;
  authorId: number;
  createdAt: string;
  onChainTxHash: string | null;
  authorName: string | null;
  authorUsername: string | null;
  authorAvatarUrl: string | null;
  likeCount: number;
  isPaid?: boolean;
  isSubscribedToAuthor?: boolean;
};

type SearchResults = {
  users: UserResult[];
  posts: PostResult[];
  query: string;
};

function getRecent(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as string[]; }
  catch { return []; }
}

function addRecent(q: string): void {
  const prev = getRecent().filter((s) => s !== q);
  localStorage.setItem(RECENT_KEY, JSON.stringify([q, ...prev].slice(0, MAX_RECENT)));
}

function removeRecent(q: string): void {
  localStorage.setItem(RECENT_KEY, JSON.stringify(getRecent().filter((s) => s !== q)));
}

// ── User card ────────────────────────────────────────────────────

function UserCard({ user, query }: { user: UserResult; query: string }) {
  const isChainVerified = !!user.registrationTxHash;
  const hasStreak = user.currentStreak > 0;

  // Highlight matching text
  const highlight = (text: string | null) => {
    if (!text || !query) return text ?? "";
    const idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return text;
    return (
      <>
        {text.slice(0, idx)}
        <mark className="bg-primary/20 text-primary rounded-sm">{text.slice(idx, idx + query.length)}</mark>
        {text.slice(idx + query.length)}
      </>
    );
  };

  return (
    <Link href={`/profile/${user.id}`}>
      <div className="flex items-center gap-3 p-4 hover:bg-muted/50 transition-colors rounded-lg cursor-pointer">
        <div className="relative flex-shrink-0">
          <Avatar className="h-11 w-11 ring-2 ring-transparent hover:ring-primary/30 transition-all">
            <AvatarImage src={user.avatarUrl ?? ""} />
            <AvatarFallback className="bg-primary/10 text-primary font-semibold text-sm">
              {user.name?.slice(0, 2).toUpperCase() ?? "??"}
            </AvatarFallback>
          </Avatar>
          {CONTRACT_DEPLOYED && isChainVerified && (
            <div className="absolute -bottom-0.5 -right-0.5 h-4 w-4 bg-violet-600 rounded-full flex items-center justify-center border border-background">
              <Shield className="h-2 w-2 text-white" />
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm">{highlight(user.name ?? "Anonymous")}</span>
            {CONTRACT_DEPLOYED && isChainVerified && (
              <span className="inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 border border-violet-200">
                <Link2 className="h-2 w-2" /> Monad
              </span>
            )}
          </div>
          <span className="text-xs text-muted-foreground">@{highlight(user.username ?? "-")}</span>
          {user.bio && (
            <p className="text-xs text-muted-foreground mt-0.5 truncate">{user.bio}</p>
          )}
        </div>

        <div className="flex items-center gap-3 text-right flex-shrink-0">
          {hasStreak && (
            <div className="flex flex-col items-center">
              <span className="text-xs text-orange-600 flex items-center gap-0.5 font-medium">
                <Flame className="h-3 w-3" />{user.currentStreak}d
              </span>
            </div>
          )}
          <div className="hidden sm:flex flex-col items-center">
            <span className="text-xs font-semibold">{user.subscriberCount}</span>
            <span className="text-[10px] text-muted-foreground">subs</span>
          </div>
          <div className="hidden sm:flex flex-col items-center">
            <span className="text-xs font-semibold">{user.postCount}</span>
            <span className="text-[10px] text-muted-foreground">posts</span>
          </div>
        </div>
      </div>
    </Link>
  );
}

// ── Post card ────────────────────────────────────────────────────

function PostCard({ post, query }: { post: PostResult; query: string }) {
  const locked = post.isPaid && !post.isSubscribedToAuthor;
  const snippet = locked ? "" : post.content?.slice(0, 200) ?? "";
  const idx = snippet.toLowerCase().indexOf(query.toLowerCase());

  const highlightedContent = () => {
    if (!query || idx === -1) return snippet;
    return (
      <>
        {snippet.slice(0, idx)}
        <mark className="bg-primary/20 text-primary rounded-sm">{snippet.slice(idx, idx + query.length)}</mark>
        {snippet.slice(idx + query.length)}
      </>
    );
  };

  return (
    <Link href={`/post/${post.id}`}>
      <div className="flex gap-3 p-4 hover:bg-muted/50 transition-colors rounded-lg cursor-pointer">
        {!locked && post.imageUrl && (
          <img
            src={post.imageUrl}
            alt=""
            className="h-14 w-14 object-cover rounded-lg flex-shrink-0"
          />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Avatar className="h-5 w-5">
              <AvatarImage src={post.authorAvatarUrl ?? ""} />
              <AvatarFallback className="text-[9px]">
                {post.authorName?.slice(0, 2).toUpperCase() ?? "??"}
              </AvatarFallback>
            </Avatar>
            <span className="text-xs text-muted-foreground font-medium">
              {post.authorName ?? post.authorUsername ?? "Anonymous"}
            </span>
            {post.onChainTxHash && CONTRACT_DEPLOYED && (
              <span className="text-[9px] font-bold text-violet-700 bg-violet-50 border border-violet-200 px-1 rounded">
                On-chain
              </span>
            )}
          </div>
          <p className="text-sm leading-snug line-clamp-2">{locked ? "Exclusive post · Subscribe to unlock" : highlightedContent()}</p>
          <div className="flex items-center gap-3 mt-1.5">
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Heart className="h-3 w-3 text-red-400" /> {post.likeCount}
            </span>
            <span className="text-xs text-muted-foreground">
              {formatDistanceToNow(new Date(post.createdAt), { addSuffix: true })}
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}

// ── Empty / idle states ──────────────────────────────────────────

function EmptyState({ query, type }: { query: string; type: string }) {
  return (
    <div className="text-center py-12 text-muted-foreground">
      <SearchIcon className="h-10 w-10 mx-auto mb-3 opacity-20" />
      <p className="font-medium">No {type === "users" ? "users" : "posts"} found for</p>
      <p className="text-primary font-semibold mt-0.5">"{query}"</p>
      <p className="text-xs mt-2 opacity-70">Try a shorter term or check the spelling.</p>
    </div>
  );
}

function IdleState({
  recent,
  onPick,
  onRemove,
}: {
  recent: string[];
  onPick: (q: string) => void;
  onRemove: (q: string) => void;
}) {
  return (
    <div className="space-y-6">
      {recent.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" /> Recent searches
          </p>
          <div className="flex flex-wrap gap-2">
            {recent.map((q) => (
              <div key={q} className="flex items-center gap-1 bg-muted rounded-full px-3 py-1.5 text-sm">
                <button className="hover:text-primary transition-colors" onClick={() => onPick(q)}>
                  {q}
                </button>
                <button
                  onClick={() => onRemove(q)}
                  className="ml-1 text-muted-foreground hover:text-destructive transition-colors"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-1.5">
          <TrendingUp className="h-3.5 w-3.5" /> Search tips
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { icon: <Users className="h-4 w-4 text-purple-500" />, title: "Find members", desc: "Search by name, username, or wallet address" },
            { icon: <FileText className="h-4 w-4 text-blue-500" />, title: "Find posts", desc: "Search any word or phrase in post content" },
            { icon: <Star className="h-4 w-4 text-yellow-500" />, title: "Discover creators", desc: "Find top creators by switching to the Users tab" },
          ].map((tip) => (
            <div key={tip.title} className="flex gap-3 p-3 bg-muted/50 rounded-lg">
              <div className="mt-0.5 flex-shrink-0">{tip.icon}</div>
              <div>
                <p className="text-sm font-medium">{tip.title}</p>
                <p className="text-xs text-muted-foreground">{tip.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────

export default function SearchPage() {
  const [, navigate] = useLocation();
  const [inputValue, setInputValue] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [recent, setRecent] = useState<string[]>(getRecent);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Focus on mount
  useEffect(() => { inputRef.current?.focus(); }, []);

  const runSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults(null);
      setActiveQuery("");
      setLoading(false);
      return;
    }
    setLoading(true);
    setActiveQuery(q);
    try {
      const wallet = localStorage.getItem("mf_wallet_address") ?? "";
      const res = await fetch(`${BASE}/api/search?q=${encodeURIComponent(q)}&type=all`, {
        headers: { "x-wallet-address": wallet },
      });
      const data = await res.json() as SearchResults;
      setResults(data);
      addRecent(q);
      setRecent(getRecent());
    } catch {
      setResults({ users: [], posts: [], query: q });
    } finally {
      setLoading(false);
    }
  }, []);

  const handleInput = (value: string) => {
    setInputValue(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!value.trim()) {
      setResults(null);
      setActiveQuery("");
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(() => void runSearch(value.trim()), 300);
  };

  const handleClear = () => {
    setInputValue("");
    setResults(null);
    setActiveQuery("");
    setLoading(false);
    inputRef.current?.focus();
  };

  const handlePickRecent = (q: string) => {
    setInputValue(q);
    void runSearch(q);
  };

  const handleRemoveRecent = (q: string) => {
    removeRecent(q);
    setRecent(getRecent());
  };

  const totalUsers = results?.users.length ?? 0;
  const totalPosts = results?.posts.length ?? 0;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2 bg-primary/10 text-primary rounded-lg flex-shrink-0">
          <SearchIcon className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Search</h1>
          <p className="text-muted-foreground text-sm">Find members, posts, and creators</p>
        </div>
      </div>

      {/* Search input */}
      <div className="relative">
        <SearchIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4.5 w-4.5 text-muted-foreground h-4 w-4" />
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => handleInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") handleClear();
            if (e.key === "Enter" && inputValue.trim()) void runSearch(inputValue.trim());
          }}
          placeholder="Search members, posts, wallet addresses…"
          className="w-full pl-10 pr-10 py-3 text-sm bg-muted border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/50 transition-all"
          autoComplete="off"
          spellCheck={false}
        />
        {loading && (
          <div className="absolute right-3.5 top-1/2 -translate-y-1/2 h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        )}
        {inputValue && !loading && (
          <button
            onClick={handleClear}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Content */}
      {!results && !loading && (
        <IdleState recent={recent} onPick={handlePickRecent} onRemove={handleRemoveRecent} />
      )}

      {results && (
        <Tabs defaultValue={totalUsers === 0 && totalPosts > 0 ? "posts" : "all"}>
          {/* Result summary */}
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs text-muted-foreground">
              {totalUsers + totalPosts === 0
                ? "No results"
                : `${totalUsers + totalPosts} result${totalUsers + totalPosts !== 1 ? "s" : ""} for `}
              {totalUsers + totalPosts > 0 && (
                <span className="font-semibold text-foreground">"{activeQuery}"</span>
              )}
            </p>
          </div>

          <TabsList className="w-full">
            <TabsTrigger value="all" className="flex-1 gap-1.5">
              All
              {totalUsers + totalPosts > 0 && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                  {totalUsers + totalPosts}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="users" className="flex-1 gap-1.5">
              <Users className="h-3.5 w-3.5" /> Members
              {totalUsers > 0 && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">{totalUsers}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="posts" className="flex-1 gap-1.5">
              <FileText className="h-3.5 w-3.5" /> Posts
              {totalPosts > 0 && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">{totalPosts}</Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {/* All tab */}
          <TabsContent value="all" className="mt-4 space-y-4">
            {totalUsers === 0 && totalPosts === 0 && (
              <EmptyState query={activeQuery} type="all" />
            )}

            {results.users.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5" /> Members ({totalUsers})
                </p>
                <Card>
                  <CardContent className="p-0 divide-y">
                    {results.users.map((u) => (
                      <UserCard key={u.id} user={u} query={activeQuery} />
                    ))}
                  </CardContent>
                </Card>
              </div>
            )}

            {results.posts.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
                  <FileText className="h-3.5 w-3.5" /> Posts ({totalPosts})
                </p>
                <Card>
                  <CardContent className="p-0 divide-y">
                    {results.posts.map((p) => (
                      <PostCard key={p.id} post={p} query={activeQuery} />
                    ))}
                  </CardContent>
                </Card>
              </div>
            )}
          </TabsContent>

          {/* Users tab */}
          <TabsContent value="users" className="mt-4">
            {results.users.length === 0 ? (
              <EmptyState query={activeQuery} type="users" />
            ) : (
              <Card>
                <CardContent className="p-0 divide-y">
                  {results.users.map((u) => (
                    <UserCard key={u.id} user={u} query={activeQuery} />
                  ))}
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Posts tab */}
          <TabsContent value="posts" className="mt-4">
            {results.posts.length === 0 ? (
              <EmptyState query={activeQuery} type="posts" />
            ) : (
              <Card>
                <CardContent className="p-0 divide-y">
                  {results.posts.map((p) => (
                    <PostCard key={p.id} post={p} query={activeQuery} />
                  ))}
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
