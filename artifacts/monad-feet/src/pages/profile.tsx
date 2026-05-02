import { useState } from "react";
import { useParams } from "wouter";
import { useUser } from "@/context/UserContext";
import { useGetUser, useListPosts, useListBadges, useGetCreatorSubscriptionPrice } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge as UiBadge } from "@/components/ui/badge";
import { PostCard } from "@/components/post/PostCard";
import { Trophy, Calendar, Flame, Lock, ExternalLink, Link2, Loader2, CheckCircle2 } from "lucide-react";
import { format } from "date-fns";
import { useContractActions } from "@/lib/useContractActions";
import { useQueryClient } from "@tanstack/react-query";
import { getGetUserQueryKey } from "@workspace/api-client-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type SubState = "idle" | "signing" | "syncing" | "done" | "error";

async function apiSubscribe(creatorId: number, txHash: string | null): Promise<void> {
  const wallet = localStorage.getItem("mf_wallet_address") ?? "";
  const res = await fetch(`${BASE}/api/subscriptions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-wallet-address": wallet },
    body: JSON.stringify({
      subscriberWalletAddress: wallet,
      creatorId,
      txHash,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? "Subscription failed");
  }
}

export default function Profile() {
  const params = useParams();
  const userId = Number(params.userId);
  const { user: currentUser } = useUser();
  const queryClient = useQueryClient();
  const isOwnProfile = currentUser?.id === userId;

  const { data: profile, isLoading } = useGetUser(userId, { query: { enabled: !!userId } });
  const { data: postsPage } = useListPosts({});
  const userPosts = postsPage?.posts.filter((p) => p.authorId === userId) ?? [];
  const { data: badges } = useListBadges({ query: { enabled: isOwnProfile } });
  const { data: subPrice } = useGetCreatorSubscriptionPrice(userId, {
    query: { enabled: !isOwnProfile && !!userId },
  });

  const { contractDeployed, subscribeOnChain } = useContractActions();
  const [subState, setSubState] = useState<SubState>("idle");
  const [subError, setSubError] = useState<string | null>(null);

  const handleSubscribe = async () => {
    if (!subPrice || !currentUser || !profile) return;
    setSubState("idle");
    setSubError(null);

    let txHash: string | null = null;

    // Step 1: On-chain subscription payment (88% → creator, 12% → platform)
    if (contractDeployed && subPrice.pricePerMonth > 0) {
      setSubState("signing");
      try {
        txHash = await subscribeOnChain(
          profile.walletAddress as `0x${string}`,
          String(subPrice.pricePerMonth)
        );
      } catch (e: unknown) {
        const err = e as Error;
        // User declined or insufficient balance
        setSubError(err.message?.includes("insufficient") ? "Insufficient MON balance" : null);
        setSubState("idle");
        return;
      }
    }

    // Step 2: Record in DB
    setSubState("syncing");
    try {
      await apiSubscribe(userId, txHash);
      queryClient.invalidateQueries({ queryKey: getGetUserQueryKey(userId) });
      setSubState("done");
    } catch (e: unknown) {
      const err = e as Error;
      setSubError(err.message ?? "Subscription failed");
      setSubState("idle");
    }
  };

  if (isLoading || !profile) return <div className="py-12 text-center">Loading...</div>;

  const isSubPending = subState === "signing" || subState === "syncing";
  const subLabel = () => {
    if (subState === "signing") return "Sign transaction...";
    if (subState === "syncing") return "Confirming...";
    if (subState === "done") return "Subscribed!";
    if (!subPrice || subPrice.pricePerMonth === 0) return "Subscribe (Free)";
    return contractDeployed
      ? `Sign & Subscribe • ${subPrice.pricePerMonth} MON/mo`
      : `Subscribe • ${subPrice.pricePerMonth} MON/mo`;
  };

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden border-none shadow-sm bg-card">
        <div className="h-32 bg-gradient-to-r from-primary/20 to-accent/40" />
        <CardContent className="px-6 pb-6 pt-0 relative">
          <div className="flex flex-col sm:flex-row gap-4 sm:items-end -mt-12 sm:-mt-16 mb-4">
            <Avatar className="h-24 w-24 sm:h-32 sm:w-32 border-4 border-background bg-background shadow-sm">
              <AvatarImage src={profile.avatarUrl || ""} />
              <AvatarFallback className="text-2xl">
                {profile.name?.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 pb-2">
              <h1 className="text-2xl font-bold">{profile.name}</h1>
              <p className="text-muted-foreground font-medium">@{profile.username}</p>
            </div>

            {!isOwnProfile && subPrice && (
              <div className="pb-2 flex flex-col items-start gap-1">
                <Button
                  onClick={handleSubscribe}
                  disabled={isSubPending || subState === "done"}
                  className="gap-2"
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
                {subError && <p className="text-xs text-destructive">{subError}</p>}
              </div>
            )}
          </div>

          <p className="text-foreground/90 max-w-2xl mb-4">{profile.bio || "No bio provided."}</p>

          <div className="flex flex-wrap gap-y-2 gap-x-5 text-sm text-muted-foreground">
            <a
              href={`https://explorer.monad.xyz/address/${profile.walletAddress}`}
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
                href={`https://explorer.monad.xyz/tx/${profile.registrationTxHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-violet-600 hover:text-violet-800 transition-colors"
              >
                <Link2 className="h-3 w-3" /> On-chain registration
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        </CardContent>
      </Card>

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
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-sm font-medium text-muted-foreground mb-1 flex items-center justify-center gap-1">
              <Flame className="h-4 w-4 text-orange-500" /> Streak
            </p>
            <p className="text-2xl font-bold">{profile.currentStreak}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-sm font-medium text-muted-foreground mb-1 flex items-center justify-center gap-1">
              <Trophy className="h-4 w-4 text-yellow-500" /> Points
            </p>
            <p className="text-2xl font-bold">{profile.streakPoints}</p>
          </CardContent>
        </Card>
      </div>

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
    </div>
  );
}
