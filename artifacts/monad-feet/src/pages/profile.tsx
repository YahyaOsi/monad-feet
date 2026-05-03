import { useState, useEffect } from "react";
import { useParams } from "wouter";
import { useUser } from "@/context/UserContext";
import { useGetUser, useListPosts, useListBadges, useGetCreatorSubscriptionPrice, useGetCreatorAnalytics, useUpdateMe } from "@workspace/api-client-react";
import { useContractActions } from "@/lib/useContractActions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge as UiBadge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useUpload } from "@workspace/object-storage-web";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { PostCard } from "@/components/post/PostCard";
import {
  Trophy, Calendar, Flame, Lock, ExternalLink, Link2,
  Loader2, CheckCircle2, Shield, AlertCircle, BarChart2,
  Users, Coins, TrendingUp, Star, MessageCircle, ShieldX, ShieldCheck, Gem, Pencil, Camera,
} from "lucide-react";
import {
  ComposedChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import { format } from "date-fns";
import { useOnChainUser, useIsSubscribedOnChain } from "@/lib/useOnChain";
import { useAccount } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { getGetUserQueryKey } from "@workspace/api-client-react";
import { CONTRACT_DEPLOYED } from "@/lib/contract";
import { useLocation } from "wouter";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type SubState = "idle" | "signing" | "syncing" | "done" | "error";

async function apiSubscribe(creatorId: number, txHash: string | null): Promise<void> {
  const wallet = localStorage.getItem("mf_wallet_address") ?? "";
  const res = await fetch(`${BASE}/api/subscriptions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-wallet-address": wallet },
    body: JSON.stringify({ subscriberWalletAddress: wallet, creatorId, txHash }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? "Subscription failed");
  }
}

export default function Profile() {
  const params = useParams();
  const userId = Number(params.userId);
  const [, navigate] = useLocation();
  const { user: currentUser } = useUser();
  const { address } = useAccount();
  const queryClient = useQueryClient();
  const isOwnProfile = currentUser?.id === userId;
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [isBlocked, setIsBlocked] = useState(false);
  const [blockLoading, setBlockLoading] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editUsername, setEditUsername] = useState("");
  const [editBio, setEditBio] = useState("");
  const [editAvatarUrl, setEditAvatarUrl] = useState("");
  const [editError, setEditError] = useState<string | null>(null);

  const { uploadFile, isUploading: isAvatarUploading, progress: avatarProgress } = useUpload({
    basePath: `${BASE}/api/storage`,
    onSuccess: (res) => {
      setEditAvatarUrl(`${BASE}/api/storage${res.objectPath}`);
    },
    onError: (err) => {
      setEditError(`Image upload failed: ${err.message}`);
    },
  });

  useEffect(() => {
    if (isOwnProfile || !userId) return;
    const wallet = localStorage.getItem("mf_wallet_address") ?? "";
    fetch(`${BASE}/api/users/${userId}/block-status`, { headers: { "x-wallet-address": wallet } })
      .then((r) => r.ok ? r.json() : null)
      .then((d: { isBlocked?: boolean } | null) => { if (d) setIsBlocked(d.isBlocked ?? false); })
      .catch(() => {});
  }, [userId, isOwnProfile]);

  const toggleBlock = async () => {
    setBlockLoading(true);
    const wallet = localStorage.getItem("mf_wallet_address") ?? "";
    try {
      const method = isBlocked ? "DELETE" : "POST";
      await fetch(`${BASE}/api/users/block/${userId}`, {
        method,
        headers: { "x-wallet-address": wallet, "Content-Type": "application/json" },
      });
      setIsBlocked((b) => !b);
    } catch { /* ignore */ } finally {
      setBlockLoading(false);
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: profile, isLoading } = useGetUser(userId, { query: { enabled: !!userId, queryKey: [] as any } });
  const { data: postsPage } = useListPosts({});
  const userPosts = postsPage?.posts.filter((p) => p.authorId === userId) ?? [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: badges } = useListBadges({ query: { enabled: isOwnProfile, queryKey: [] as any } });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: subPrice } = useGetCreatorSubscriptionPrice(userId, {
    query: { enabled: !isOwnProfile && !!userId, queryKey: [] as any },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: analytics } = useGetCreatorAnalytics(userId, {
    query: { enabled: (isOwnProfile || analyticsOpen) && !!userId, queryKey: [] as any },
  });

  // On-chain reads
  const { data: onChainUser, isLoading: chainLoading } = useOnChainUser(
    profile?.walletAddress as `0x${string}` | undefined
  );
  const { data: isSubscribedOnChain } = useIsSubscribedOnChain(
    address,
    !isOwnProfile ? (profile?.walletAddress as `0x${string}` | undefined) : undefined
  );

  const { contractDeployed, subscribeOnChain, updateProfileOnChain } = useContractActions();
  const [subState, setSubState] = useState<SubState>("idle");
  const [subError, setSubError] = useState<string | null>(null);
  const [editStep, setEditStep] = useState<"idle" | "saving" | "signing" | "done">("idle");

  const { mutateAsync: updateMeAsync, isPending: isUpdating } = useUpdateMe();

  const openEditDialog = () => {
    if (!profile) return;
    setEditName(profile.name ?? "");
    setEditUsername(profile.username ?? "");
    setEditBio(profile.bio ?? "");
    setEditAvatarUrl(profile.avatarUrl ?? "");
    setEditError(null);
    setEditStep("idle");
    setEditOpen(true);
  };

  const handleEditSave = async () => {
    const wallet = localStorage.getItem("mf_wallet_address") ?? "";
    if (!editName.trim()) { setEditError("Name is required"); return; }
    if (!editUsername.trim()) { setEditError("Username is required"); return; }
    setEditError(null);
    try {
      setEditStep("saving");
      await updateMeAsync({
        data: {
          walletAddress: wallet,
          name: editName.trim(),
          username: editUsername.trim(),
          bio: editBio.trim() || null,
          avatarUrl: editAvatarUrl.trim() || null,
        },
      });

      if (contractDeployed) {
        setEditStep("signing");
        try {
          await updateProfileOnChain(
            editName.trim(),
            editBio.trim(),
            editAvatarUrl.trim(),
          );
        } catch { /* user declined — profile already saved to DB */ }
      }

      setEditStep("done");
      queryClient.invalidateQueries({ queryKey: getGetUserQueryKey(userId) });
      setTimeout(() => { setEditOpen(false); setEditStep("idle"); }, 800);
    } catch (err) {
      setEditError((err as Error)?.message ?? "Failed to save changes");
      setEditStep("idle");
    }
  };

  const handleSubscribe = async () => {
    if (!subPrice || !currentUser || !profile) return;
    setSubError(null);

    let txHash: string | null = null;
    if (contractDeployed && subPrice.pricePerMonth > 0) {
      setSubState("signing");
      try {
        txHash = await subscribeOnChain(
          profile.walletAddress as `0x${string}`,
          String(subPrice.pricePerMonth)
        );
      } catch (e: unknown) {
        const err = e as Error;
        setSubError(err.message?.includes("insufficient") ? "Insufficient MON balance" : null);
        setSubState("idle");
        return;
      }
    }

    setSubState("syncing");
    try {
      await apiSubscribe(userId, txHash);
      queryClient.invalidateQueries({ queryKey: getGetUserQueryKey(userId) });
      setSubState("done");
    } catch (e: unknown) {
      setSubError((e as Error).message ?? "Subscription failed");
      setSubState("idle");
    }
  };

  if (isLoading || !profile) return <div className="py-12 text-center">Loading...</div>;

  const isSubPending = subState === "signing" || subState === "syncing";
  const onChainRegistered = onChainUser?.[0] === true;
  const onChainStreakFromChain = onChainUser?.[6] ? Number(onChainUser[6]) : null;
  const onChainPointsFromChain = onChainUser?.[5] ? Number(onChainUser[5]) : null;

  const subLabel = () => {
    if (subState === "signing") return "Sign transaction...";
    if (subState === "syncing") return "Confirming...";
    if (subState === "done" || isSubscribedOnChain) return "Subscribed";
    if (!subPrice || subPrice.pricePerMonth === 0) return "Follow";
    return `Subscribe · ${subPrice.pricePerMonth} MON/mo`;
  };

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden border-none shadow-sm bg-card">
        <div className="h-32 bg-gradient-to-r from-primary/20 to-violet-500/20" />
        <CardContent className="px-6 pb-6 pt-0 relative">
          <div className="flex flex-col sm:flex-row gap-4 sm:items-end -mt-12 sm:-mt-16 mb-4">
            <Avatar className="h-24 w-24 sm:h-32 sm:w-32 border-4 border-background bg-background shadow-sm">
              <AvatarImage src={profile.avatarUrl ?? ""} />
              <AvatarFallback className="text-2xl">{profile.name?.slice(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
            <div className="flex-1 pb-2">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-2xl font-bold">{profile.name}</h1>
                {profile.nftHolder && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200" title="Monad Feet NFT Holder — earns 2× streak points">
                    <Gem className="h-2.5 w-2.5" /> NFT Holder
                  </span>
                )}
                {CONTRACT_DEPLOYED && !chainLoading && onChainRegistered && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 border border-violet-200">
                    <Shield className="h-2.5 w-2.5" /> Verified on Monad
                  </span>
                )}
                {CONTRACT_DEPLOYED && !chainLoading && !onChainRegistered && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground border">
                    <AlertCircle className="h-2.5 w-2.5" /> Chain unverified
                  </span>
                )}
                {profile.subscriptionPrice !== null && profile.subscriptionPrice !== undefined && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
                    <Star className="h-2.5 w-2.5" /> Creator
                  </span>
                )}
              </div>
              <p className="text-muted-foreground font-medium">@{profile.username}</p>
            </div>

            {!isOwnProfile && subPrice !== undefined && (
              <div className="pb-2 flex flex-col items-start gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <Button
                    onClick={handleSubscribe}
                    disabled={isSubPending || subState === "done" || isSubscribedOnChain === true}
                    className="gap-2"
                    variant={subState === "done" || isSubscribedOnChain ? "secondary" : "default"}
                  >
                    {isSubPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : subState === "done" || isSubscribedOnChain ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : (
                      <Lock className="h-4 w-4" />
                    )}
                    {subLabel()}
                  </Button>
                  <Button
                    variant="outline"
                    className="gap-2"
                    onClick={() => navigate(`/messages?userId=${userId}`)}
                  >
                    <MessageCircle className="h-4 w-4" />
                    Message
                  </Button>
                  <Button
                    variant="outline"
                    className={`gap-2 ${isBlocked ? "border-destructive/50 text-destructive hover:bg-destructive/10" : "text-muted-foreground"}`}
                    onClick={() => void toggleBlock()}
                    disabled={blockLoading}
                  >
                    {blockLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : isBlocked ? (
                      <ShieldCheck className="h-4 w-4" />
                    ) : (
                      <ShieldX className="h-4 w-4" />
                    )}
                    {isBlocked ? "Unblock" : "Block"}
                  </Button>
                </div>
                {isSubscribedOnChain && (
                  <p className="text-xs text-green-600 flex items-center gap-1">
                    <Link2 className="h-3 w-3" /> Verified on-chain
                  </p>
                )}
                {subError && <p className="text-xs text-destructive">{subError}</p>}
              </div>
            )}

            {isOwnProfile && (
              <div className="pb-2 flex items-center gap-2 flex-wrap">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={openEditDialog}
                  className="gap-2"
                >
                  <Pencil className="h-4 w-4" />
                  Edit Profile
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setAnalyticsOpen(!analyticsOpen)}
                  className="gap-2"
                >
                  <BarChart2 className="h-4 w-4" />
                  {analyticsOpen ? "Hide Analytics" : "Creator Analytics"}
                </Button>
              </div>
            )}
          </div>

          <p className="text-foreground/90 max-w-2xl mb-4">{profile.bio ?? "No bio provided."}</p>

          <div className="flex flex-wrap gap-y-2 gap-x-5 text-sm text-muted-foreground">
            <a
              href={`https://monvision.io/address/${profile.walletAddress}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 hover:text-primary transition-colors"
            >
              <span className="font-mono bg-muted px-1.5 py-0.5 rounded text-xs">
                {profile.walletAddress.slice(0, 6)}…{profile.walletAddress.slice(-4)}
              </span>
              <ExternalLink className="h-3 w-3" />
            </a>
            <div className="flex items-center gap-1.5">
              <Calendar className="h-4 w-4" />
              Joined {format(new Date(profile.createdAt), "MMMM yyyy")}
            </div>
            {profile.registrationTxHash && (
              <a
                href={`https://monvision.io/tx/${profile.registrationTxHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-violet-600 hover:text-violet-800 transition-colors text-xs"
              >
                <Link2 className="h-3 w-3" /> On-chain registration
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-sm font-medium text-muted-foreground mb-1">Posts</p>
            <p className="text-2xl font-bold">{profile.postCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-sm font-medium text-muted-foreground mb-1">Likes Received</p>
            <p className="text-2xl font-bold">{profile.totalLikes}</p>
          </CardContent>
        </Card>
        <Card className={onChainStreakFromChain !== null ? "border-violet-200 bg-violet-50/30" : ""}>
          <CardContent className="p-4 text-center">
            <p className="text-sm font-medium text-muted-foreground mb-1 flex items-center justify-center gap-1">
              <Flame className="h-4 w-4 text-orange-500" /> Streak
              {onChainStreakFromChain !== null && <Link2 className="h-3 w-3 text-violet-500" />}
            </p>
            <p className="text-2xl font-bold">
              {onChainStreakFromChain !== null ? onChainStreakFromChain : profile.currentStreak}
            </p>
            {onChainStreakFromChain !== null && (
              <p className="text-[10px] text-violet-600 font-semibold mt-0.5">on-chain</p>
            )}
          </CardContent>
        </Card>
        <Card className={onChainPointsFromChain !== null ? "border-violet-200 bg-violet-50/30" : ""}>
          <CardContent className="p-4 text-center">
            <p className="text-sm font-medium text-muted-foreground mb-1 flex items-center justify-center gap-1">
              <Trophy className="h-4 w-4 text-yellow-500" /> Points
              {onChainPointsFromChain !== null && <Link2 className="h-3 w-3 text-violet-500" />}
            </p>
            <p className="text-2xl font-bold">
              {onChainPointsFromChain !== null ? onChainPointsFromChain : profile.streakPoints}
            </p>
            {onChainPointsFromChain !== null && (
              <p className="text-[10px] text-violet-600 font-semibold mt-0.5">on-chain</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Creator Analytics Panel */}
      {isOwnProfile && analyticsOpen && analytics && (
        <Card className="border-primary/20 bg-primary/5">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <BarChart2 className="h-5 w-5 text-primary" /> Creator Analytics
            </CardTitle>
            <CardDescription>Your creator stats and revenue overview</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-background rounded-xl p-3 text-center border">
                <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground mb-1">
                  <Users className="h-3 w-3" /> Active Subs
                </div>
                <p className="text-2xl font-bold text-primary">{analytics.activeSubscribers}</p>
                <p className="text-[10px] text-muted-foreground">of {analytics.totalSubscribers} total</p>
              </div>
              <div className="bg-background rounded-xl p-3 text-center border">
                <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground mb-1">
                  <Coins className="h-3 w-3 text-yellow-500" /> Monthly Revenue
                </div>
                <p className="text-2xl font-bold text-yellow-600">{analytics.monthlyRevenueMon.toFixed(2)}</p>
                <p className="text-[10px] text-muted-foreground">MON/month</p>
              </div>
              <div className="bg-background rounded-xl p-3 text-center border">
                <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground mb-1">
                  <TrendingUp className="h-3 w-3 text-green-500" /> Total Revenue
                </div>
                <p className="text-2xl font-bold text-green-600">{analytics.totalRevenueMon.toFixed(2)}</p>
                <p className="text-[10px] text-muted-foreground">MON all-time</p>
              </div>
              <div className="bg-background rounded-xl p-3 text-center border">
                <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground mb-1">
                  <Lock className="h-3 w-3" /> Private Posts
                </div>
                <p className="text-2xl font-bold">{analytics.privatePosts}</p>
                <p className="text-[10px] text-muted-foreground">exclusive content</p>
              </div>
            </div>

            {/* Shareable Earnings Card */}
            {analytics.subscriberGrowth && analytics.subscriberGrowth.length > 0 && (() => {
              const growth = analytics.subscriberGrowth!;
              const hasAnyData = growth.some((d) => d.newSubscribers > 0 || d.monEarned > 0);
              const totalNew = growth.reduce((s, d) => s + d.newSubscribers, 0);
              const totalMon = growth.reduce((s, d) => s + d.monEarned, 0);
              return (
                <div className="relative overflow-hidden rounded-2xl shadow-2xl border border-violet-800/40"
                  style={{ background: "linear-gradient(135deg, #12012e 0%, #1e0550 45%, #0c001e 100%)" }}>
                  {/* Decorative blobs */}
                  <div className="absolute -top-8 -right-8 w-48 h-48 rounded-full pointer-events-none"
                    style={{ background: "radial-gradient(circle, rgba(139,92,246,0.22) 0%, transparent 70%)" }} />
                  <div className="absolute -bottom-8 -left-8 w-40 h-40 rounded-full pointer-events-none"
                    style={{ background: "radial-gradient(circle, rgba(251,191,36,0.18) 0%, transparent 70%)" }} />

                  <div className="relative p-5 space-y-4">
                    {/* Header: creator identity + branding */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Avatar className="h-10 w-10 border-2 border-violet-400/50 shadow-lg">
                          <AvatarImage src={profile.avatarUrl ?? ""} />
                          <AvatarFallback className="text-sm font-bold" style={{ background: "#2d0a5e", color: "#c4b5fd" }}>
                            {profile.name?.slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="text-white font-bold text-sm leading-tight">{profile.name}</p>
                          {profile.username && <p className="text-violet-300 text-xs">@{profile.username}</p>}
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-[11px] font-black tracking-widest uppercase text-violet-300">Monad Feet</p>
                        <p className="text-[9px] text-violet-500">monad.xyz</p>
                      </div>
                    </div>

                    {/* Big stats row */}
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-violet-400 mb-1">12-wk earnings</p>
                        <p className="text-4xl font-black leading-none" style={{ color: "#fbbf24" }}>
                          {totalMon % 1 === 0 ? totalMon.toFixed(0) : totalMon.toFixed(2)}
                        </p>
                        <p className="text-xs font-bold text-amber-400/70 mt-0.5">MON earned</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-violet-400 mb-1">New subscribers</p>
                        <p className="text-4xl font-black leading-none text-white">{totalNew}</p>
                        <p className="text-xs font-bold text-violet-300/70 mt-0.5">in 12 weeks</p>
                      </div>
                    </div>

                    {/* Dual-axis chart */}
                    {hasAnyData ? (
                      <div>
                        <ResponsiveContainer width="100%" height={140}>
                          <ComposedChart data={growth} margin={{ top: 4, right: 36, left: -22, bottom: 0 }}>
                            <defs>
                              <linearGradient id="subGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#a78bfa" stopOpacity={0.4} />
                                <stop offset="95%" stopColor="#a78bfa" stopOpacity={0} />
                              </linearGradient>
                              <linearGradient id="monGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#fbbf24" stopOpacity={0.35} />
                                <stop offset="95%" stopColor="#fbbf24" stopOpacity={0} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                            <XAxis
                              dataKey="week"
                              tick={{ fontSize: 9, fill: "rgba(196,181,253,0.55)" }}
                              tickLine={false}
                              axisLine={false}
                              interval={2}
                            />
                            <YAxis
                              yAxisId="left"
                              tick={{ fontSize: 9, fill: "rgba(196,181,253,0.55)" }}
                              tickLine={false}
                              axisLine={false}
                              allowDecimals={false}
                            />
                            <YAxis
                              yAxisId="right"
                              orientation="right"
                              tick={{ fontSize: 9, fill: "rgba(251,191,36,0.55)" }}
                              tickLine={false}
                              axisLine={false}
                              allowDecimals={false}
                            />
                            <Tooltip
                              contentStyle={{
                                background: "#1a0533",
                                border: "1px solid rgba(139,92,246,0.4)",
                                borderRadius: "10px",
                                fontSize: "11px",
                                padding: "8px 12px",
                              }}
                              labelStyle={{ color: "#c4b5fd", fontWeight: 700, marginBottom: 4 }}
                              formatter={(v: number, name: string) =>
                                name === "monEarned"
                                  ? [`${v.toFixed(2)} MON`, "Revenue"]
                                  : [v, "Subscribers"]
                              }
                              cursor={{ stroke: "rgba(167,139,250,0.3)", strokeWidth: 1 }}
                            />
                            <Area
                              yAxisId="left"
                              type="monotone"
                              dataKey="newSubscribers"
                              stroke="#a78bfa"
                              strokeWidth={2}
                              fill="url(#subGrad)"
                              dot={false}
                              activeDot={{ r: 4, fill: "#a78bfa", strokeWidth: 0 }}
                              name="newSubscribers"
                            />
                            <Area
                              yAxisId="right"
                              type="monotone"
                              dataKey="monEarned"
                              stroke="#fbbf24"
                              strokeWidth={2}
                              fill="url(#monGrad)"
                              dot={false}
                              activeDot={{ r: 4, fill: "#fbbf24", strokeWidth: 0 }}
                              name="monEarned"
                            />
                          </ComposedChart>
                        </ResponsiveContainer>
                      </div>
                    ) : (
                      <div className="h-[140px] flex items-center justify-center">
                        <div className="text-center">
                          <Users className="h-8 w-8 mx-auto mb-2" style={{ color: "rgba(167,139,250,0.3)" }} />
                          <p className="text-xs text-violet-400/60">No subscribers yet — create exclusive content to start earning</p>
                        </div>
                      </div>
                    )}

                    {/* Legend + screenshot hint */}
                    <div className="flex items-center justify-between pt-1">
                      <div className="flex items-center gap-4">
                        <span className="flex items-center gap-1.5 text-[10px] text-violet-300">
                          <span className="h-2 w-2 rounded-full bg-violet-400 inline-block" />
                          Subscribers
                        </span>
                        <span className="flex items-center gap-1.5 text-[10px] text-amber-300">
                          <span className="h-2 w-2 rounded-full bg-amber-400 inline-block" />
                          MON earned
                        </span>
                      </div>
                      <span className="flex items-center gap-1 text-[10px] text-violet-500/60">
                        <Camera className="h-3 w-3" /> Screenshot to share
                      </span>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Recent subscribers */}
            {analytics.recentSubscribers.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Recent Subscribers</p>
                <div className="space-y-2">
                  {analytics.recentSubscribers.map((sub) => (
                    <div key={sub.subscriberId} className="flex items-center gap-3 bg-background rounded-lg border p-2.5">
                      <Avatar className="h-8 w-8 flex-shrink-0">
                        <AvatarImage src={sub.subscriberAvatarUrl ?? ""} />
                        <AvatarFallback className="text-xs bg-primary/10 text-primary">
                          {sub.subscriberName?.slice(0, 2).toUpperCase() ?? "??"}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{sub.subscriberName ?? `User #${sub.subscriberId}`}</p>
                        <p className="text-xs text-muted-foreground">
                          {sub.consecutiveMonths} month{sub.consecutiveMonths !== 1 ? "s" : ""} · {format(new Date(sub.subscribedAt), "MMM d, yyyy")}
                        </p>
                      </div>
                      {sub.consecutiveMonths >= 2 && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200 flex-shrink-0">
                          Loyal
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Top posts */}
            {analytics.topPosts.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Top Posts by Likes</p>
                <div className="space-y-2">
                  {analytics.topPosts.slice(0, 3).map((post, i) => (
                    <div key={post.id} className="flex items-center gap-2 bg-background rounded-lg border p-2.5">
                      <span className="text-sm font-bold text-muted-foreground w-5 text-center">#{i + 1}</span>
                      {post.imageUrl && (
                        <img src={post.imageUrl} alt="" className="h-10 w-10 rounded object-cover flex-shrink-0" />
                      )}
                      <p className="text-xs text-foreground/80 flex-1 truncate">{post.content || "No caption"}</p>
                      <span className="flex items-center gap-1 text-xs font-semibold text-red-500 flex-shrink-0">
                        ♥ {post.likeCount ?? 0}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {isOwnProfile && badges && badges.length > 0 && (
        <div className="space-y-4">
          <h3 className="font-semibold text-lg">Badges</h3>
          <div className="flex flex-wrap gap-2">
            {badges.map((b) => (
              <UiBadge
                key={b.id}
                variant="secondary"
                className="px-3 py-1.5 text-sm gap-1.5 bg-primary/10 text-primary hover:bg-primary/20"
              >
                <Trophy className="h-3.5 w-3.5" />
                {b.label}
              </UiBadge>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-4 pt-4">
        <h3 className="font-semibold text-lg border-b pb-2">Posts</h3>
        {userPosts.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">No posts yet.</div>
        ) : (
          userPosts.map((post) => <PostCard key={post.id} post={post} />)
        )}
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Profile</DialogTitle>
          </DialogHeader>

          <div className="space-y-5 py-2">
            <div className="flex items-center gap-4">
              <div className="relative group flex-shrink-0">
                <Avatar className="h-20 w-20 border-2 border-border">
                  <AvatarImage src={editAvatarUrl} />
                  <AvatarFallback className="text-xl">{editName.slice(0, 2).toUpperCase() || "?"}</AvatarFallback>
                </Avatar>
                <label
                  htmlFor="avatar-upload"
                  className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                >
                  {isAvatarUploading ? (
                    <Loader2 className="h-5 w-5 text-white animate-spin" />
                  ) : (
                    <Pencil className="h-5 w-5 text-white" />
                  )}
                </label>
                <input
                  id="avatar-upload"
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  disabled={isAvatarUploading}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void uploadFile(file);
                    e.target.value = "";
                  }}
                />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium">Profile picture</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {isAvatarUploading
                    ? `Uploading… ${avatarProgress}%`
                    : "Hover over the avatar and click to upload a new photo"}
                </p>
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="edit-name">Display name</Label>
              <Input
                id="edit-name"
                placeholder="Your name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                maxLength={64}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="edit-username">Username</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">@</span>
                <Input
                  id="edit-username"
                  placeholder="username"
                  value={editUsername}
                  onChange={(e) => setEditUsername(e.target.value.replace(/\s/g, "").toLowerCase())}
                  className="pl-7"
                  maxLength={32}
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="edit-bio">Bio</Label>
              <Textarea
                id="edit-bio"
                placeholder="Tell everyone a bit about yourself..."
                value={editBio}
                onChange={(e) => setEditBio(e.target.value)}
                rows={3}
                maxLength={280}
              />
              <p className="text-xs text-muted-foreground text-right">{editBio.length}/280</p>
            </div>

            {editError && (
              <p className="text-sm text-destructive">{editError}</p>
            )}
          </div>

          {contractDeployed && editStep === "signing" && (
            <div className="flex items-center gap-2 text-xs text-violet-700 bg-violet-50 border border-violet-200 rounded-lg px-3 py-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin flex-shrink-0" />
              Check your wallet — sign to anchor your profile on Monad Mainnet…
            </div>
          )}
          {editStep === "done" && (
            <div className="flex items-center gap-2 text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
              <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" />
              Profile saved{contractDeployed ? " & anchored on-chain" : ""}!
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)} disabled={editStep === "saving" || editStep === "signing"}>
              Cancel
            </Button>
            <Button onClick={() => void handleEditSave()} disabled={editStep !== "idle" || isAvatarUploading} className="gap-2">
              {(editStep === "saving" || editStep === "signing") && <Loader2 className="h-4 w-4 animate-spin" />}
              {editStep === "saving" ? "Saving…" : editStep === "signing" ? "Sign on Monad…" : editStep === "done" ? "Saved!" : contractDeployed ? "Save & Sign on Monad" : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
