import { useState, useEffect } from "react";
import { useParams } from "wouter";
import { useUser } from "@/context/UserContext";
import { useGetUser, useListPosts, useListBadges, useGetCreatorSubscriptionPrice, useGetCreatorAnalytics, useUpdateMe, useListSubscriptions, getListSubscriptionsQueryKey } from "@workspace/api-client-react";
import { useContractActions } from "@/lib/useContractActions";
import { useSubscriptionPayment } from "@/lib/useSubscriptionPayment";
import { Slider } from "@/components/ui/slider";
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
  Users, Coins, TrendingUp, Star, MessageCircle, ShieldX, ShieldCheck, Pencil, Camera, Share2,
} from "lucide-react";
import {
  ComposedChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import { format } from "date-fns";
import { useOnChainUser, useIsSubscribedOnChain } from "@/lib/useOnChain";
import { useAccount } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { getGetUserQueryKey, getListPostsQueryKey, getListBadgesQueryKey, getGetCreatorSubscriptionPriceQueryKey, getGetCreatorAnalyticsQueryKey } from "@workspace/api-client-react";
import { CONTRACT_DEPLOYED } from "@/lib/contract";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { usePageMetadata } from "@/hooks/usePageMetadata";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type SubState = "idle" | "signing" | "syncing" | "done" | "error";


// Paid subscriptions use the user-provided Monad deployment. The server
// verifies the treasury, transaction receipt, creator, and exact listed price.
const CHAIN_PAYMENTS_ENABLED = true;

export default function Profile({ promptLogin }: { promptLogin: () => void }) {
  const params = useParams();
  const userId = Number(params.userId);
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { user: currentUser } = useUser();
  const viewerScope = currentUser ? `${currentUser.id}:${currentUser.walletAddress.toLowerCase()}` : "guest";
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
  const [postsPagination, setPostsPagination] = useState<{ profileId: number; cursor: number | null }>({
    profileId: userId,
    cursor: null,
  });
  const postsCursor = postsPagination.profileId === userId ? postsPagination.cursor : null;
  const [userPosts, setUserPosts] = useState<import("@workspace/api-client-react").Post[]>([]);

  const shareProfile = async () => {
    const url = new URL(`${BASE}/profile/${userId}`, window.location.origin).href;
    if (navigator.share) {
      try {
        await navigator.share({ title: `${profile?.name ?? "Monad Feet"} on Monad Feet`, url });
        toast({ title: "Profile link sent to your device for sharing" });
        return;
      } catch (error) {
        // Dismissing the native share sheet is not a failure.
        if (error instanceof DOMException && error.name === "AbortError") return;
        // Unsupported share payloads and device errors can still use the link.
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: "Public profile link copied", description: "Anyone with the link can view this profile." });
    } catch {
      toast({ variant: "destructive", title: "Could not copy profile link", description: "Check clipboard permissions and try again." });
    }
  };

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
    if (isOwnProfile || !userId || !currentUser) return;
    const wallet = localStorage.getItem("mf_wallet_address") ?? "";
    fetch(`${BASE}/api/users/${userId}/block-status`, { headers: { "x-wallet-address": wallet } })
      .then((r) => r.ok ? r.json() : null)
      .then((d: { isBlocked?: boolean } | null) => { if (d) setIsBlocked(d.isBlocked ?? false); })
      .catch(() => {});
  }, [userId, isOwnProfile, currentUser]);

  const toggleBlock = async () => {
    if (!currentUser) { promptLogin(); return; }
    if (!isBlocked && !window.confirm("Block this member? Direct messages between you will be stopped. This does not delete posts or on-chain records. You can unblock them from this profile.")) return;
    setBlockLoading(true);
    const wallet = localStorage.getItem("mf_wallet_address") ?? "";
    try {
      const method = isBlocked ? "DELETE" : "POST";
      const response = await fetch(`${BASE}/api/users/block/${userId}`, {
        method,
        headers: { "x-wallet-address": wallet, "Content-Type": "application/json" },
      });
      if (!response.ok) throw new Error("Blocking could not be updated. Please retry.");
      setIsBlocked((b) => !b);
      toast({ title: isBlocked ? "Member unblocked" : "Member blocked", description: isBlocked ? "Direct messages are available again." : "Direct messages are stopped. Use Unblock here to reverse this." });
    } catch (error) {
      toast({ variant: "destructive", title: "Block not updated", description: error instanceof Error ? error.message : "Please retry." });
    } finally {
      setBlockLoading(false);
    }
  };

  const { data: profile, isLoading, isError: profileError, error: profileQueryError } = useGetUser(userId, {
    query: {
      enabled: Number.isSafeInteger(userId) && userId > 0,
      queryKey: [...getGetUserQueryKey(userId), viewerScope],
    },
    request: { credentials: currentUser ? "include" : "omit" },
  });
  const authorParams = {
    authorId: userId,
    ...(postsCursor !== null ? { cursor: postsCursor } : {}),
  };
  const { data: postsPage, isLoading: postsLoading, isFetching: postsFetching, isError: postsError } = useListPosts(authorParams, {
    query: {
      enabled: Number.isSafeInteger(userId) && userId > 0,
      queryKey: [...getListPostsQueryKey(authorParams), viewerScope],
    },
    request: { credentials: currentUser ? "include" : "omit" },
  });
  useEffect(() => {
    setUserPosts([]);
  }, [userId]);
  useEffect(() => {
    if (!postsPage || postsPage.posts.some((post) => post.authorId !== userId)) return;
    setUserPosts((previous) => {
      const byId = new Map(previous.map((post) => [post.id, post]));
      for (const post of postsPage.posts) byId.set(post.id, post);
      return [...byId.values()];
    });
  }, [postsPage, userId]);
  const badgeParams = { userId };
  const { data: badges } = useListBadges(badgeParams, {
    query: {
      enabled: Number.isSafeInteger(userId) && userId > 0,
      queryKey: [...getListBadgesQueryKey(badgeParams), viewerScope],
    },
    request: { credentials: currentUser ? "include" : "omit" },
  });
  const { data: mySubs } = useListSubscriptions({
    query: {
      enabled: !!currentUser && !isOwnProfile,
      queryKey: [...getListSubscriptionsQueryKey(), viewerScope],
    },
  });
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNowTick(Date.now()), 60_000); return () => clearInterval(t); }, []);
  const activeSub = (mySubs ?? []).find((s) => {
    if (s.creatorId !== userId) return false;
    const ext = s as typeof s & { status?: string | null; verified?: boolean | null };
    const statusOk = !ext.status || ext.status.toUpperCase() === "ACTIVE";
    const verifiedOk = ext.verified === undefined || ext.verified === null ? !!s.txHash : ext.verified;
    return statusOk && verifiedOk && new Date(s.expiresAt).getTime() > nowTick;
  });
  const subDaysLeft = activeSub ? Math.max(0, Math.ceil((new Date(activeSub.expiresAt).getTime() - nowTick) / 86_400_000)) : 0;
  const { data: subPrice, isLoading: subPriceLoading, isError: subPriceError } = useGetCreatorSubscriptionPrice(userId, {
    query: { enabled: !isOwnProfile && !!userId, queryKey: getGetCreatorSubscriptionPriceQueryKey(userId) },
  });
  const { data: analytics } = useGetCreatorAnalytics(userId, {
    query: {
      enabled: (isOwnProfile || analyticsOpen) && !!userId,
      queryKey: [...getGetCreatorAnalyticsQueryKey(userId), viewerScope],
    },
  });
  usePageMetadata(
    profile?.name ? `${profile.name} (@${profile.username}) on Monad Feet` : "Monad Feet profile",
    profile?.bio || `View ${profile?.name ?? "this creator"}'s public Monad Feet profile and posts.`,
  );

  // On-chain reads
  const { data: onChainUser, isLoading: chainLoading } = useOnChainUser(
    profile?.walletAddress as `0x${string}` | undefined
  );
  const { data: isSubscribedOnChain } = useIsSubscribedOnChain(
    address,
    !isOwnProfile ? (profile?.walletAddress as `0x${string}` | undefined) : undefined
  );

  const { contractDeployed, updateProfileOnChain } = useContractActions();
  const paySubscription = useSubscriptionPayment();
  const [subState, setSubState] = useState<SubState>("idle");
  const [subError, setSubError] = useState<string | null>(null);
  const [editStep, setEditStep] = useState<"idle" | "saving" | "signing" | "done">("idle");

  // Subscription price picker state
  const [priceOpen, setPriceOpen] = useState(false);
  const [priceValue, setPriceValue] = useState(100);
  const [priceSaving, setPriceSaving] = useState(false);
  const [priceError, setPriceError] = useState<string | null>(null);
  const [priceSaved, setPriceSaved] = useState(false);

  const openPriceDialog = () => {
    const current = profile?.subscriptionPrice ? Number(profile.subscriptionPrice) : 100;
    setPriceValue(Math.min(8000, Math.max(10, current)));
    setPriceError(null);
    setPriceSaved(false);
    setPriceOpen(true);
  };

  const savePrice = async () => {
    if (!profile) return;
    setPriceSaving(true);
    setPriceError(null);
    try {
      const wallet = localStorage.getItem("mf_wallet_address") ?? "";
      const res = await fetch(`${BASE}/api/subscriptions/price`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-wallet-address": wallet },
        body: JSON.stringify({ walletAddress: profile.walletAddress, pricePerMonth: priceValue }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? "Failed to save price");
      }
      queryClient.invalidateQueries({ queryKey: getGetUserQueryKey(userId) });
      queryClient.invalidateQueries({ queryKey: getGetCreatorSubscriptionPriceQueryKey(userId) });
      setPriceSaved(true);
      setTimeout(() => setPriceOpen(false), 1200);
    } catch (e) {
      setPriceError(e instanceof Error ? e.message : "Failed to save price");
    } finally {
      setPriceSaving(false);
    }
  };

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
        } catch { /* user declined, profile already saved to DB */ }
      }

      setEditStep("done");
      queryClient.invalidateQueries({ queryKey: getGetUserQueryKey(userId) });
      setTimeout(() => { setEditOpen(false); setEditStep("idle"); }, 800);
    } catch (err) {
      setEditError((err as Error)?.message ?? "Failed to save changes");
      setEditStep("idle");
    }
  };

  const paidSubscriptionsBlocked = !CHAIN_PAYMENTS_ENABLED;
  const hasValidSubPrice = !subPriceLoading && !subPriceError &&
    subPrice?.creatorId === userId && typeof subPrice.pricePerMonth === "number" &&
    Number.isFinite(subPrice.pricePerMonth) && subPrice.pricePerMonth > 0;

  const handleSubscribe = async () => {
    if (!currentUser) { promptLogin(); return; }
    if (!hasValidSubPrice || !currentUser || !profile) return;
    if (paidSubscriptionsBlocked) return;
    setSubError(null);

    setSubState("signing");
    try {
      if (!await paySubscription(userId)) { setSubState("idle"); return; }
      queryClient.invalidateQueries({ queryKey: getGetUserQueryKey(userId) });
      queryClient.invalidateQueries({ queryKey: getListSubscriptionsQueryKey() });
      setSubState("done");
    } catch (e: unknown) {
      setSubError((e as Error).message ?? "Subscription failed");
      setSubState("idle");
    }
  };

  if (isLoading) return <div className="py-12 text-center" role="status">Loading profile…</div>;
  const profileNotFound = (profileQueryError as { status?: number } | null)?.status === 404;
  if (profileError && !profileNotFound) return <div className="py-12 text-center space-y-3"><p role="alert">Could not load this profile. Please try again.</p></div>;
  if (!profile) return <div className="py-12 text-center">Profile not found.</div>;

  const isSubPending = subState === "signing" || subState === "syncing";
  const onChainRegistered = onChainUser?.[0] === true;
  const onChainStreakFromChain = onChainUser?.[6] ? Number(onChainUser[6]) : null;
  const onChainPointsFromChain = onChainUser?.[5] ? Number(onChainUser[5]) : null;

  const subLabel = () => {
    if (subState === "signing") return "Sign transaction...";
    if (subState === "syncing") return "Confirming...";
    if (subState === "done") return "Subscribed";
    if (subPriceLoading) return "Loading subscription price...";
    if (subPriceError) return "Subscription price unavailable";
    if (!hasValidSubPrice || !subPrice) return "Subscriptions not open";
    if (paidSubscriptionsBlocked) return `${subPrice.pricePerMonth} MON/mo · Not open yet`;
    return `Subscribe · ${subPrice.pricePerMonth} MON/mo`;
  };

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden border border-border shadow-sm bg-card rounded-2xl">
        <CardContent className="px-4 sm:px-6 pb-6 pt-8 relative">
          <div className="flex flex-col items-center text-center gap-4 mb-4">
            <Avatar className="h-24 w-24 sm:h-32 sm:w-32 ring-4 ring-primary/15 ring-offset-4 ring-offset-card bg-muted shadow-sm">
              <AvatarImage src={profile.avatarUrl ?? ""} alt={`${profile.name ?? "User"} profile picture`} className="object-cover" />
              <AvatarFallback className="text-2xl font-semibold bg-primary/15 text-primary">{profile.name?.slice(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
            <div className="w-full">
              <div className="flex items-center justify-center gap-2 flex-wrap">
                <h1 className="text-2xl font-bold max-w-full break-words [overflow-wrap:anywhere]">{profile.name}</h1>
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
              <p className="text-muted-foreground font-medium break-all">@{profile.username}</p>
            </div>

            <Button variant="outline" size="sm" className="gap-2" onClick={() => void shareProfile()}>
              <Share2 className="h-4 w-4" />
              Share Profile
            </Button>

            {!isOwnProfile && (
              <div className="flex flex-col items-center gap-2">
                <div className="flex items-center justify-center gap-2 flex-wrap">
                  {activeSub ? (
                    <span
                      className="inline-flex h-9 items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 text-sm font-medium text-green-700"
                      data-testid="status-subscription-active"
                      title={`Access until ${format(new Date(activeSub.expiresAt), "MMM d, yyyy")}`}
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      {subDaysLeft <= 1 ? "Subscribed, ends today" : `Subscribed, ${subDaysLeft} days left`}
                    </span>
                  ) : (
                  <Button
                    onClick={() => void handleSubscribe()}
                     disabled={!hasValidSubPrice || paidSubscriptionsBlocked || isSubPending || subState === "done"}
                    aria-describedby={paidSubscriptionsBlocked ? "sub-payments-note" : undefined}
                    className="gap-2"
                     variant={subState === "done" ? "secondary" : "default"}
                  >
                    {isSubPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                     ) : subState === "done" ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : (
                      <Lock className="h-4 w-4" />
                    )}
                    {subLabel()}
                  </Button>
                  )}
                  <Button
                    variant="outline"
                    className="gap-2"
                    onClick={() => currentUser ? navigate(`/messages?userId=${userId}`) : promptLogin()}
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
                     <Link2 className="h-3 w-3" /> Registry reports an active onchain subscription (site access requires a verified receipt)
                  </p>
                )}
                {paidSubscriptionsBlocked && (
                  <p id="sub-payments-note" className="text-xs text-muted-foreground max-w-xs">
                     Payments are paused. No MON will be charged until the contract and treasury checks pass.
                  </p>
                )}
                 {activeSub && (
                   <p className="text-xs text-muted-foreground" data-testid="text-subscription-expiry">
                     Access ends {format(new Date(activeSub.expiresAt), "MMM d, yyyy")}. You can renew after it ends.
                   </p>
                 )}
                 {!activeSub && !paidSubscriptionsBlocked && hasValidSubPrice && (
                   <p className="max-w-xs text-center text-xs text-muted-foreground">
                     Subscribe to enjoy this creator’s exclusive content for 30 days.
                   </p>
                 )}
                {subError && <p className="text-xs text-destructive">{subError}</p>}
              </div>
            )}

            {isOwnProfile && (
              <div className="flex items-center justify-center gap-2 flex-wrap">
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
                <Button
                  variant="outline"
                  size="sm"
                  onClick={openPriceDialog}
                  className="gap-2"
                >
                  <Coins className="h-4 w-4" />
                  {profile?.subscriptionPrice ? `${profile.subscriptionPrice} MON / mo` : "Set Subscription Price"}
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
                <Link2 className="h-3 w-3" /> Onchain registration
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
              <p className="text-[10px] text-violet-600 font-semibold mt-0.5">onchain</p>
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
              <p className="text-[10px] text-violet-600 font-semibold mt-0.5">onchain</p>
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
                <p className="text-[10px] text-muted-foreground">MON all time</p>
              </div>
              <div className="bg-background rounded-xl p-3 text-center border">
                <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground mb-1">
                  <Lock className="h-3 w-3" /> Private Posts
                </div>
                <p className="text-2xl font-bold">{analytics.privatePosts}</p>
                <p className="text-[10px] text-muted-foreground">exclusive content</p>
              </div>
            </div>


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
                      {(!("isPaid" in post) || post.isPaid !== true || ("isSubscribedToAuthor" in post && post.isSubscribedToAuthor === true)) && post.imageUrl && (
                        <img src={post.imageUrl} alt="" className="h-10 w-10 rounded object-cover flex-shrink-0" />
                      )}
                      <p className="text-xs text-foreground/80 flex-1 truncate">
                        {"isPaid" in post && post.isPaid === true && !("isSubscribedToAuthor" in post && post.isSubscribedToAuthor === true)
                          ? "Exclusive post · Subscribe to unlock"
                          : post.content || "No caption"}
                      </p>
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

      {badges && badges.length > 0 && (
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
        {postsError && <div className="text-center py-3 text-destructive" role="alert">Could not load this creator's posts. Please try again.</div>}
        {userPosts.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">{postsLoading ? "Loading posts…" : "No posts yet."}</div>
        ) : (
          userPosts.map((post) => <PostCard key={post.id} post={post} onRequireLogin={promptLogin} />)
        )}
        {postsPage?.nextCursor != null && (
          <Button
            variant="outline"
            className="w-full"
            onClick={() => setPostsPagination({ profileId: userId, cursor: postsPage.nextCursor ?? null })}
            disabled={postsFetching}
            data-testid="button-load-more-profile-posts"
          >
            {postsFetching ? "Loading…" : "Load more posts"}
          </Button>
        )}
      </div>

      {/* Subscription Price Picker Dialog */}
      <Dialog open={priceOpen} onOpenChange={setPriceOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Coins className="h-5 w-5 text-yellow-500" /> Subscription Price
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-5 py-2">
            <p className="text-sm text-muted-foreground">
              Set how much subscribers pay per month to access your exclusive content.
            </p>

            {/* Current display */}
            <div className="text-center">
              <span className="text-4xl font-bold text-primary">{priceValue}</span>
              <span className="text-lg font-semibold text-muted-foreground ml-2">MON / mo</span>
            </div>

            {/* Slider */}
            <div className="px-1">
              <Slider
                min={10}
                max={8000}
                step={10}
                value={[priceValue]}
                onValueChange={([v]) => setPriceValue(v ?? priceValue)}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-muted-foreground mt-1">
                <span>10 MON</span>
                <span>8,000 MON</span>
              </div>
            </div>

            {/* Number input */}
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={10}
                max={8000}
                step={10}
                value={priceValue}
                onChange={(e) => {
                  const v = Math.min(8000, Math.max(10, Number(e.target.value) || 10));
                  setPriceValue(v);
                }}
                className="text-center font-mono"
              />
              <span className="text-sm font-medium text-muted-foreground flex-shrink-0">MON / mo</span>
            </div>

            {/* Preset chips */}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Quick presets</p>
              <div className="flex flex-wrap gap-2">
                {[10, 50, 100, 250, 500, 1000, 5000, 8000].map((p) => (
                  <button
                    key={p}
                    onClick={() => setPriceValue(p)}
                    className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${
                      priceValue === p
                        ? "bg-primary text-primary-foreground border-primary"
                        : "border-border text-muted-foreground hover:border-primary hover:text-primary"
                    }`}
                  >
                    {p} MON
                  </button>
                ))}
              </div>
            </div>

            {priceError && (
              <p className="text-sm text-destructive flex items-center gap-1.5">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                {priceError}
              </p>
            )}
            {priceSaved && (
              <p className="text-sm text-green-600 flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                Subscription price saved!
              </p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setPriceOpen(false)} disabled={priceSaving}>
              Cancel
            </Button>
            <Button onClick={() => void savePrice()} disabled={priceSaving || priceSaved} className="gap-2">
              {priceSaving && <Loader2 className="h-4 w-4 animate-spin" />}
              {priceSaved ? "Saved!" : priceSaving ? "Saving…" : "Save Price"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
              Check your wallet, sign to anchor your profile on Monad…
            </div>
          )}
          {editStep === "done" && (
            <div className="flex items-center gap-2 text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
              <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" />
              Profile saved{contractDeployed ? " & anchored onchain" : ""}!
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
