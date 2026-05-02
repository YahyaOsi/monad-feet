import { useState } from "react";
import { Link } from "wouter";
import { useUser } from "@/context/UserContext";
import { useListSubscriptions, useListPrivatePosts } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Lock, Crown, ExternalLink, Link2, CheckCircle2, Calendar, Loader2
} from "lucide-react";
import { formatDistanceToNow, format, isPast } from "date-fns";
import { useAccount } from "wagmi";
import { useIsSubscribedOnChain, useSubscriptionExpiry } from "@/lib/useOnChain";
import { CONTRACT_DEPLOYED } from "@/lib/contract";

function SubscriptionExpiry({
  subscriber,
  creator,
  dbExpiry,
}: {
  subscriber?: `0x${string}`;
  creator?: `0x${string}`;
  dbExpiry: string;
}) {
  const { data: chainExpiry } = useSubscriptionExpiry(subscriber, creator);

  const expiryDate = chainExpiry
    ? new Date(Number(chainExpiry) * 1000)
    : new Date(dbExpiry);

  const expired = isPast(expiryDate);

  return (
    <span className={`text-xs flex items-center gap-1 ${expired ? "text-destructive" : "text-muted-foreground"}`}>
      <Calendar className="h-3 w-3" />
      {expired ? "Expired" : `Renews ${format(expiryDate, "MMM d, yyyy")}`}
      {chainExpiry && <Link2 className="h-2.5 w-2.5 text-violet-500" />}
    </span>
  );
}

function ChainSubBadge({ subscriber, creator, txHash }: {
  subscriber?: `0x${string}`;
  creator?: `0x${string}`;
  txHash?: string | null;
}) {
  const { data: isSubOnChain } = useIsSubscribedOnChain(subscriber, creator);

  if (!CONTRACT_DEPLOYED) return null;

  if (isSubOnChain) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 border border-green-200">
        <CheckCircle2 className="h-2.5 w-2.5" /> On-chain
      </span>
    );
  }

  if (txHash) {
    return (
      <a
        href={`https://explorer.monad.xyz/tx/${txHash}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 border border-violet-200 hover:bg-violet-200 transition-colors"
      >
        <Link2 className="h-2.5 w-2.5" /> Tx
        <ExternalLink className="h-2 w-2" />
      </a>
    );
  }

  return null;
}

function PrivatePosts({ creatorId }: { creatorId: number }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: posts, isLoading } = useListPrivatePosts({ creatorId }, { query: { enabled: creatorId > 0, queryKey: [] as any } });

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[...Array(2)].map((_, i) => (
          <Card key={i} className="animate-pulse h-32" />
        ))}
      </div>
    );
  }

  if (!posts || posts.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          <Lock className="h-8 w-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No private posts yet from this creator.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {posts.map((post) => (
        <Card key={post.id} className="border-primary/20 bg-primary/5 overflow-hidden">
          <CardHeader className="p-4 pb-2 flex flex-row items-center justify-between">
            <div className="flex items-center gap-3">
              <Avatar className="h-9 w-9">
                <AvatarImage src={post.creatorAvatarUrl ?? ""} />
                <AvatarFallback>{post.creatorName?.slice(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
              <div>
                <p className="font-semibold text-sm">{post.creatorName}</p>
                <p className="text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(post.createdAt), { addSuffix: true })}
                </p>
              </div>
            </div>
            <Badge variant="secondary" className="gap-1 text-xs bg-primary/10 text-primary border-primary/20">
              <Lock className="h-3 w-3" /> Subscriber Only
            </Badge>
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-2 space-y-3">
            {post.content && <p className="whitespace-pre-wrap text-sm leading-relaxed">{post.content}</p>}
            {post.imageUrl && (
              <div className="rounded-xl overflow-hidden bg-muted">
                <img src={post.imageUrl} alt="Post" className="w-full max-h-96 object-cover" />
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function PrivateFeed() {
  const { user } = useUser();
  const { address } = useAccount();
  const [selectedCreatorId, setSelectedCreatorId] = useState<number | null>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: subscriptions, isLoading: subsLoading } = useListSubscriptions();

  const activeSubs = subscriptions ?? [];
  const selectedSub = activeSubs.find((s) => s.creatorId === selectedCreatorId) ?? activeSubs[0];
  const activeCreatorId = selectedCreatorId ?? activeSubs[0]?.creatorId ?? 0;

  if (subsLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 text-primary rounded-lg"><Lock className="h-6 w-6" /></div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Private Feed</h1>
            <p className="text-muted-foreground">Exclusive content from creators you subscribe to</p>
          </div>
        </div>
        <div className="space-y-3">{[...Array(3)].map((_, i) => <Card key={i} className="animate-pulse h-24" />)}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-primary/10 text-primary rounded-lg"><Lock className="h-6 w-6" /></div>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Private Feed</h1>
          <p className="text-muted-foreground">Exclusive content from creators you subscribe to</p>
        </div>
      </div>

      {activeSubs.length === 0 ? (
        <Card className="border-dashed bg-muted/30">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Crown className="h-12 w-12 text-muted-foreground mb-4 opacity-50" />
            <h2 className="text-xl font-semibold mb-2">No Subscriptions Yet</h2>
            <p className="text-muted-foreground max-w-sm mb-4 text-sm">
              Subscribe to creators from their profile to unlock exclusive private content. MON is sent
              directly to their wallet on-chain.
            </p>
            <p className="text-xs text-muted-foreground/60">
              Visit a creator's profile → click Subscribe → sign the on-chain transaction.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid md:grid-cols-[280px_1fr] gap-6 items-start">
          {/* Creator sidebar */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-1 mb-3">
              Your Subscriptions
            </p>
            {activeSubs.map((sub) => {
              const isActive = sub.creatorId === activeCreatorId;
              return (
                <button
                  key={sub.id}
                  onClick={() => setSelectedCreatorId(sub.creatorId)}
                  className={`w-full text-left rounded-xl border p-3 transition-all space-y-2 ${
                    isActive
                      ? "border-primary/40 bg-primary/5 shadow-sm"
                      : "border-border hover:border-primary/20 hover:bg-muted/30"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Avatar className="h-10 w-10 flex-shrink-0">
                      <AvatarImage src={sub.creatorAvatarUrl ?? ""} />
                      <AvatarFallback className="text-xs">
                        {sub.creatorName?.slice(0, 2).toUpperCase() ?? "??"}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Link
                          href={`/profile/${sub.creatorId}`}
                          className="font-semibold text-sm hover:underline truncate"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {sub.creatorName}
                        </Link>
                        <ChainSubBadge
                          subscriber={address}
                          creator={sub.creatorWalletAddress as `0x${string}` | undefined}
                          txHash={sub.txHash}
                        />
                      </div>
                      <SubscriptionExpiry
                        subscriber={address}
                        creator={sub.creatorWalletAddress as `0x${string}` | undefined}
                        dbExpiry={sub.expiresAt}
                      />
                    </div>
                  </div>
                  {sub.txHash && (
                    <a
                      href={`https://explorer.monad.xyz/tx/${sub.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="flex items-center gap-1 text-[10px] text-violet-600 hover:text-violet-800 font-mono transition-colors"
                    >
                      <Link2 className="h-2.5 w-2.5" />
                      {sub.txHash.slice(0, 10)}…{sub.txHash.slice(-6)}
                      <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  )}
                </button>
              );
            })}
          </div>

          {/* Posts */}
          <div>
            {activeCreatorId > 0 ? (
              <PrivatePosts creatorId={activeCreatorId} />
            ) : (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  <Loader2 className="h-6 w-6 mx-auto mb-2 animate-spin opacity-30" />
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
