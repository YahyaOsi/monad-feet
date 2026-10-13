import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Link2, Copy, CheckCircle2, ExternalLink, Users, FileText,
  Zap, Shield, AlertCircle, Terminal, RefreshCw, Globe,
  Activity, UserPlus, Heart, Repeat2, Flame, Radio, UserCog, Gift, MessageSquare
} from "lucide-react";
import {
  CONTRACT_DEPLOYED,
  MONAD_FEET_CONTRACT_ADDRESS,
  MONAD_MAINNET_CHAIN_ID,
} from "@/lib/contract";
import { useContractUserCount, useContractPostCount } from "@/lib/useOnChain";
import { useGetFeedSummary, getGetFeedSummaryQueryKey, useGetChainEvents, getGetChainEventsQueryKey } from "@workspace/api-client-react";
import { formatDistanceToNow } from "date-fns";

const EXPLORER = "https://monvision.io";
const RPC_URL = "https://rpc.monad.xyz";

type EventKind = string;

interface LiveEvent {
  id: string;
  kind: EventKind;
  label: string;
  sublabel: string;
  txHash: string;
  at: Date;
}

type EventMeta = { icon: React.ReactNode; color: string; bg: string };
const FALLBACK_META: EventMeta = { icon: <Activity className="h-3.5 w-3.5" />, color: "text-violet-700", bg: "bg-violet-50 border-violet-200" };
const EVENT_META: Record<string, EventMeta> = {
  GamePlayed:     { icon: <Zap className="h-3.5 w-3.5" />,      color: "text-amber-700",  bg: "bg-amber-50 border-amber-200"   },
  InviteEarned:   { icon: <Gift className="h-3.5 w-3.5" />,     color: "text-emerald-700", bg: "bg-emerald-50 border-emerald-200" },
  UserRegistered: { icon: <UserPlus className="h-3.5 w-3.5" />, color: "text-green-700",  bg: "bg-green-50 border-green-200"   },
  PostCreated:    { icon: <FileText className="h-3.5 w-3.5" />, color: "text-blue-700",   bg: "bg-blue-50 border-blue-200"     },
  PostLiked:      { icon: <Heart className="h-3.5 w-3.5" />,    color: "text-red-700",    bg: "bg-red-50 border-red-200"       },
  Subscribed:     { icon: <Repeat2 className="h-3.5 w-3.5" />,  color: "text-purple-700", bg: "bg-purple-50 border-purple-200" },
  StreakCheckin:  { icon: <Flame className="h-3.5 w-3.5" />,    color: "text-orange-700", bg: "bg-orange-50 border-orange-200" },
  ProfileUpdated: { icon: <UserCog className="h-3.5 w-3.5" />,  color: "text-cyan-700",   bg: "bg-cyan-50 border-cyan-200"     },
};

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
    >
      {copied ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

function StatBox({ label, chain, db, icon, loading }: {
  label: string; chain?: string | number; db?: number; icon: React.ReactNode; loading?: boolean;
}) {
  return (
    <div className="bg-muted/50 rounded-xl p-4 space-y-1">
      <div className="flex items-center gap-2 text-sm text-muted-foreground font-medium">{icon} {label}</div>
      <div className="flex items-end gap-3">
        <div>
          <div className="text-2xl font-bold">
            {loading ? <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" /> : (chain ?? "-")}
          </div>
          <div className="text-xs text-violet-600 font-medium">Onchain</div>
        </div>
        {db !== undefined && (
          <div className="pb-0.5">
            <div className="text-sm font-semibold text-muted-foreground">{db}</div>
            <div className="text-xs text-muted-foreground">Database</div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ChainPage() {
  const { data: userCount, isLoading: usersLoading, refetch: refetchUsers } = useContractUserCount();
  const { data: postCount, isLoading: postsLoading, refetch: refetchPosts } = useContractPostCount();
  const { data: summary, refetch: refetchSummary } = useGetFeedSummary({
    query: { queryKey: getGetFeedSummaryQueryKey(), refetchInterval: 30_000, refetchOnWindowFocus: true },
  });

  const eventsQuery = useGetChainEvents({
    query: { queryKey: getGetChainEventsQueryKey(), refetchInterval: 15_000, refetchOnWindowFocus: true, retry: 2 },
  });
  const [clearedBefore, setClearedBefore] = useState(0);
  const liveEvents = useMemo(() => {
    const seen = new Map<string, LiveEvent>();
    for (const ev of eventsQuery.data?.events ?? []) {
      const at = new Date(ev.at);
      if (!Number.isFinite(at.getTime()) || at.getTime() <= clearedBefore) continue;
      const key = ev.id || `${ev.txHash}:${ev.kind}`;
      if (!seen.has(key)) seen.set(key, { ...ev, id: key, at });
    }
    return [...seen.values()].sort((x, y) => y.at.getTime() - x.at.getTime() || y.id.localeCompare(x.id)).slice(0, 60);
  }, [eventsQuery.data, clearedBefore]);
  const eventsError = eventsQuery.isError;

  const handleRefresh = () => { refetchUsers(); refetchPosts(); refetchSummary(); };

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Link2 className="h-7 w-7 text-violet-600" /> Onchain Status
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Live data from MonadFeet contract on Monad
          </p>
        </div>
        {CONTRACT_DEPLOYED && (
          <Button variant="outline" size="sm" onClick={handleRefresh} className="gap-2 flex-shrink-0">
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
        )}
      </div>

      {/* Contract Status */}
      <Card className={CONTRACT_DEPLOYED ? "border-green-200 bg-green-50/50" : "border-amber-200 bg-amber-50/50"}>
        <CardContent className="p-5">
          <div className="flex items-center gap-3">
            {CONTRACT_DEPLOYED ? (
              <>
                <div className="h-10 w-10 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                </div>
                <div className="flex-1">
                  <p className="font-semibold text-green-800">Live on Monad</p>
                  <p className="text-xs text-green-700 mt-0.5">All user actions are being permanently recorded onchain.</p>
                </div>
              </>
            ) : (
              <>
                <div className="h-10 w-10 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
                  <AlertCircle className="h-5 w-5 text-amber-600" />
                </div>
                <div className="flex-1">
                  <p className="font-semibold text-amber-800">Contract Not Deployed</p>
                  <p className="text-xs text-amber-700 mt-0.5">Actions save to the database only. Deploy to go fully onchain.</p>
                </div>
                <Badge className="bg-amber-100 text-amber-700 border-amber-200 flex-shrink-0">Demo Mode</Badge>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Contract Address */}
      {CONTRACT_DEPLOYED && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Shield className="h-4 w-4 text-violet-600" /> Contract
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 bg-muted rounded-lg px-3 py-2">
              <code className="text-sm font-mono flex-1 break-all">{MONAD_FEET_CONTRACT_ADDRESS}</code>
              <CopyButton text={MONAD_FEET_CONTRACT_ADDRESS} />
              <a
                href={`${EXPLORER}/address/${MONAD_FEET_CONTRACT_ADDRESS}`}
                target="_blank" rel="noopener noreferrer"
                className="text-muted-foreground hover:text-violet-600 transition-colors"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Live Stats */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Zap className="h-4 w-4 text-yellow-500" /> Live Stats
          </CardTitle>
          <CardDescription>
            {CONTRACT_DEPLOYED
              ? "Numbers read directly from the contract, updating every 30 seconds"
              : "Onchain features are not live yet. Showing app counts."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            <StatBox
              label="Registered Users"
              chain={CONTRACT_DEPLOYED && userCount !== undefined ? Number(userCount).toLocaleString() : undefined}
              db={summary?.totalUsers}
              icon={<Users className="h-3.5 w-3.5" />}
              loading={usersLoading}
            />
            <StatBox
              label="Posts Anchored"
              chain={CONTRACT_DEPLOYED && postCount !== undefined ? Number(postCount).toLocaleString() : undefined}
              db={summary?.totalPosts}
              icon={<FileText className="h-3.5 w-3.5" />}
              loading={postsLoading}
            />
          </div>
        </CardContent>
      </Card>

      {/* App activity, distinct from lifetime registry counts */}
      {summary && <section aria-label="App activity" className="space-y-3">
        <h2 className="text-base font-semibold">App Activity</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Card className="bg-primary/5 border-none shadow-none">
            <CardContent className="p-4 flex items-center gap-4">
              <div className="p-3 bg-primary/10 rounded-full text-primary">
                <MessageSquare className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Published app posts</p>
                <p className="text-2xl font-bold">{summary.totalPosts}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-primary/5 border-none shadow-none">
            <CardContent className="p-4 flex items-center gap-4">
              <div className="p-3 bg-primary/10 rounded-full text-primary">
                <Heart className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Likes</p>
                <p className="text-2xl font-bold">{summary.totalLikes}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-primary/5 border-none shadow-none">
            <CardContent className="p-4 flex items-center gap-4">
              <div className="p-3 bg-primary/10 rounded-full text-primary">
                <Users className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Active Today</p>
                <p className="text-2xl font-bold">{summary.activeToday}</p>
              </div>
            </CardContent>
          </Card>
        </div>
        <p className="text-xs text-muted-foreground">
          App count: verified public and exclusive publications saved here. Registry lifetime anchors: {summary.totalOnChainPosts ?? "temporarily unavailable"}.
          Unconfirmed historical app-post records: {summary.totalPendingHistoricalPosts ?? 0}, excluded from the published count.
          An on-chain transaction awaiting app recovery can also make the totals differ.
        </p>
      </section>}

      {/* Live Event Feed */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Activity className="h-4 w-4 text-primary" /> Live Event Feed
                {!eventsError && eventsQuery.data && (
                  <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700 border border-green-200" data-testid="status-live-events">
                    <Radio className="h-2.5 w-2.5" /> Live
                  </span>
                )}
              </CardTitle>
              <CardDescription className="mt-1">
                {eventsQuery.data
                  ? `Confirmed contract events, refreshed every 15 seconds. Block ${eventsQuery.data.latestBlock}, updated ${formatDistanceToNow(new Date(eventsQuery.data.updatedAt), { addSuffix: true })}.`
                  : "Confirmed contract events from Monad, refreshed every 15 seconds."}
              </CardDescription>
            </div>
            {liveEvents.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setClearedBefore(liveEvents[0]?.at.getTime() ?? Date.now())} className="text-xs text-muted-foreground">
                Clear
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {eventsError && (
            <div role="alert" className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs" data-testid="status-live-events-error">
              <span className="text-destructive">Could not refresh events{liveEvents.length ? ". Showing the last good list." : "."}</span>
              <Button size="sm" variant="outline" onClick={() => void eventsQuery.refetch()} data-testid="button-retry-live-events">Retry</Button>
            </div>
          )}
          {eventsQuery.isLoading ? (
            <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-14 animate-pulse rounded-lg bg-muted" />)}</div>
          ) : liveEvents.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground" data-testid="status-live-events-empty">
              <Activity className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm font-medium">{eventsError ? "Events unavailable right now" : "No confirmed events yet"}</p>
              <p className="text-xs mt-1 text-muted-foreground/70">
                Registrations, posts, likes, check ins, spa treatments and invites show up here once confirmed.
              </p>
            </div>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {liveEvents.map(ev => {
                const meta = EVENT_META[ev.kind] ?? FALLBACK_META;
                return (
                  <div key={ev.id} className={`flex items-start gap-3 rounded-lg border p-3 ${meta.bg}`}>
                    <div className={`mt-0.5 flex-shrink-0 ${meta.color}`}>{meta.icon}</div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs font-semibold ${meta.color}`}>{ev.label}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">{ev.sublabel}</p>
                      <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                        {formatDistanceToNow(ev.at, { addSuffix: true })}
                      </p>
                    </div>
                    {ev.txHash && (
                      <a
                        href={`${EXPLORER}/tx/${ev.txHash}`}
                        target="_blank" rel="noopener noreferrer"
                        className={`flex-shrink-0 flex items-center gap-1 text-[10px] font-mono ${meta.color} hover:underline`}
                      >
                        {ev.txHash.slice(0, 8)}…
                        <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Contract Functions Reference */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Contract Functions</CardTitle>
          <CardDescription>Every user action recorded on Monad</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {[
              { fn: "registerUser(username, inviteCode)", trigger: "Join Monad Feet", gas: "~80k" },
              { fn: "createPost(postId, contentUri)", trigger: "Post to feed", gas: "~60k" },
              { fn: "likePost(postId)", trigger: "Like a post", gas: "~45k" },
              { fn: "subscribe(creator) payable", trigger: "Subscribe to creator", gas: "~50k" },
              { fn: "dailyCheckin()", trigger: "Daily streak check in", gas: "~35k" },
            ].map(({ fn, trigger, gas }) => (
              <div key={fn} className="flex items-center gap-3 py-2 border-b border-border/50 last:border-0">
                <code className="text-xs font-mono bg-violet-50 text-violet-700 px-2 py-1 rounded flex-1 min-w-0 truncate">{fn}</code>
                <span className="text-xs text-muted-foreground hidden sm:block w-36 flex-shrink-0">{trigger}</span>
                <span className="text-xs text-muted-foreground font-mono flex-shrink-0">{gas}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
