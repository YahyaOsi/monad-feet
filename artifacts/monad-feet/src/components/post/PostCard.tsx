import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { formatDistanceToNow } from "date-fns";
import type { Post } from "@workspace/api-client-react";
import { useUnlikePost, getListPostsQueryKey, getGetPostQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Heart, ExternalLink, Loader2, Link2, Shield, MessageSquare,
  Share2, Check, Gem, Lock, Crown
} from "lucide-react";
import { useContractActions } from "@/lib/useContractActions";
import { useOnChainPostLikeCount, useIsPostLikedOnChain } from "@/lib/useOnChain";
import { CONTRACT_DEPLOYED } from "@/lib/contract";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export function PostCard({ post }: { post: Post }) {
  const queryClient = useQueryClient();
  const { address } = useAccount();
  const [, navigate] = useLocation();
  const unlikePost = useUnlikePost();
  const { contractDeployed, likePostOnChain } = useContractActions();

  const [liking, setLiking] = useState(false);
  const [optimisticLiked, setOptimisticLiked] = useState<boolean | null>(null);
  const [optimisticCount, setOptimisticCount] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  const { data: chainLikeCount } = useOnChainPostLikeCount(post.id);
  const { data: chainLikedByMe } = useIsPostLikedOnChain(post.id, address);

  const isLiked = optimisticLiked !== null
    ? optimisticLiked
    : (CONTRACT_DEPLOYED && chainLikedByMe !== undefined ? chainLikedByMe : post.likedByMe);

  const likeCount = optimisticCount !== null
    ? optimisticCount
    : (CONTRACT_DEPLOYED && chainLikeCount !== undefined ? Number(chainLikeCount) : (post.likeCount ?? 0));

  // Paid post: blur image/content if user is not subscribed and is not the author
  const isBlurred = (post as Post & { isPaid?: boolean; isSubscribedToAuthor?: boolean }).isPaid
    && !(post as Post & { isPaid?: boolean; isSubscribedToAuthor?: boolean }).isSubscribedToAuthor;

  const handleLikeToggle = async () => {
    if (liking || isBlurred) return;
    setLiking(true);
    const wasLiked = isLiked;

    if (!wasLiked) {
      setOptimisticLiked(true);
      setOptimisticCount(likeCount + 1);

      let txHash: string | null = null;
      if (contractDeployed) {
        try { txHash = await likePostOnChain(post.id); } catch { /* user declined */ }
      }

      try {
        const wallet = localStorage.getItem("mf_wallet_address") ?? "";
        await fetch(`${BASE}/api/posts/${post.id}/like`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-wallet-address": wallet },
          body: JSON.stringify({ txHash }),
        });
        queryClient.invalidateQueries({ queryKey: getListPostsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetPostQueryKey(post.id) });
      } catch {
        setOptimisticLiked(wasLiked);
        setOptimisticCount(likeCount);
      }
    } else {
      setOptimisticLiked(false);
      setOptimisticCount(Math.max(0, likeCount - 1));
      try {
        await unlikePost.mutateAsync({ postId: post.id });
        queryClient.invalidateQueries({ queryKey: getListPostsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetPostQueryKey(post.id) });
      } catch {
        setOptimisticLiked(wasLiked);
        setOptimisticCount(likeCount);
      }
    }

    setLiking(false);
  };

  const handleShare = async (e: React.MouseEvent) => {
    e.preventDefault();
    const url = `${window.location.origin}${BASE}/post/${post.id}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: `Post by @${post.authorUsername}`, url });
      } else {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch { /* dismissed */ }
  };

  const initials = post.authorName ? post.authorName.slice(0, 2).toUpperCase() : "??";
  const explorerTxUrl = post.onChainTxHash ? `https://monvision.io/tx/${post.onChainTxHash}` : null;
  const isChainVerified = !!post.onChainTxHash;
  const usingChainCount = CONTRACT_DEPLOYED && chainLikeCount !== undefined;

  return (
    <Card className="overflow-hidden transition-all duration-200 group hover:shadow-md">
      {/* Post image */}
      {post.imageUrl && (
        isBlurred ? (
          /* Blurred paid post image with lock overlay */
          <div className="relative w-full overflow-hidden bg-muted aspect-video select-none">
            <img
              src={post.imageUrl}
              alt="Exclusive post"
              className="w-full h-full object-cover blur-xl scale-110 brightness-75"
            />
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/30">
              <div className="p-3 bg-background/90 backdrop-blur-sm rounded-full shadow-lg">
                <Lock className="h-7 w-7 text-primary" />
              </div>
              <p className="text-white font-bold text-base drop-shadow">Exclusive content</p>
              <p className="text-white/80 text-xs drop-shadow">Subscribe to unlock this post</p>
              <Button
                size="sm"
                className="gap-1.5 mt-1 bg-primary hover:bg-primary/90 shadow-lg"
                onClick={() => navigate(`/profile/${post.authorId}`)}
              >
                <Crown className="h-3.5 w-3.5" />
                Subscribe to @{post.authorUsername}
              </Button>
            </div>
          </div>
        ) : (
          <Link href={`/post/${post.id}`}>
            <div className="w-full overflow-hidden bg-muted cursor-pointer">
              <img
                src={post.imageUrl}
                alt="Post image"
                className="w-full max-h-[480px] object-cover group-hover:scale-[1.005] transition-transform duration-300"
              />
            </div>
          </Link>
        )
      )}

      <CardHeader className="p-4 pb-2 flex flex-row items-center gap-3">
        <Link href={`/profile/${post.authorId}`}>
          <Avatar className="h-9 w-9 cursor-pointer ring-2 ring-transparent hover:ring-primary/30 transition-all">
            <AvatarImage src={post.authorAvatarUrl ?? ""} alt={post.authorName ?? "User"} />
            <AvatarFallback className="bg-primary/10 text-primary font-medium text-xs">
              {initials}
            </AvatarFallback>
          </Avatar>
        </Link>

        <div className="flex flex-col flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <Link href={`/profile/${post.authorId}`} className="font-semibold text-sm hover:underline truncate">
              {post.authorName}
            </Link>
            {post.authorNftHolder && (
              <span title="Monad Feet NFT Holder" className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200 flex-shrink-0">
                <Gem className="h-2.5 w-2.5" />
              </span>
            )}
            {(post as Post & { isPaid?: boolean }).isPaid && (
              <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200 flex-shrink-0">
                <Crown className="h-2.5 w-2.5" />
                Exclusive
              </span>
            )}
          </div>
          <div className="flex items-center text-xs text-muted-foreground gap-1">
            <span>@{post.authorUsername}</span>
            <span>·</span>
            <Link href={`/post/${post.id}`} className="hover:underline">
              {formatDistanceToNow(new Date(post.createdAt), { addSuffix: true })}
            </Link>
          </div>
        </div>

        {isChainVerified && explorerTxUrl && (
          <a
            href={explorerTxUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-shrink-0 flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 hover:bg-violet-200 transition-colors border border-violet-200"
            title="Anchored on Monad Mainnet"
          >
            <Shield className="h-2.5 w-2.5" />
            On Monad
            <ExternalLink className="h-2.5 w-2.5" />
          </a>
        )}
      </CardHeader>

      {post.content && (
        <CardContent className="px-4 pb-2 pt-0">
          {isBlurred ? (
            <p className="whitespace-pre-wrap text-foreground/90 leading-relaxed text-sm select-none blur-sm pointer-events-none">
              {post.content}
            </p>
          ) : (
            <Link href={`/post/${post.id}`}>
              <p className="whitespace-pre-wrap text-foreground/90 leading-relaxed text-sm cursor-pointer hover:text-foreground transition-colors">{post.content}</p>
            </Link>
          )}
        </CardContent>
      )}

      <CardFooter className="p-4 pt-2 border-t border-border/50 bg-muted/20 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className={`gap-1.5 rounded-full transition-colors ${
              isLiked
                ? "text-red-500 hover:text-red-600 hover:bg-red-50"
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={handleLikeToggle}
            disabled={liking || isBlurred}
          >
            {liking && !isLiked ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Heart className={`h-4 w-4 ${isLiked ? "fill-current" : ""}`} />
            )}
            <span className="font-medium">{likeCount}</span>
          </Button>

          {usingChainCount && (
            <span className="flex items-center gap-0.5 text-[10px] text-violet-600 font-medium">
              <Link2 className="h-2.5 w-2.5" /> chain
            </span>
          )}

          {!isBlurred && (
            <Link href={`/post/${post.id}`}>
              <Button variant="ghost" size="sm" className="gap-1.5 rounded-full text-muted-foreground hover:text-foreground">
                <MessageSquare className="h-4 w-4" />
                <span className="text-xs">Comment</span>
              </Button>
            </Link>
          )}
        </div>

        <div className="flex items-center gap-2">
          {isBlurred ? (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-xs h-7 px-2.5 border-primary/30 text-primary hover:bg-primary/5"
              onClick={() => navigate(`/profile/${post.authorId}`)}
            >
              <Crown className="h-3 w-3" />
              Subscribe to unlock
            </Button>
          ) : (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleShare}
                className="gap-1 rounded-full text-muted-foreground hover:text-foreground h-8 px-2"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Share2 className="h-3.5 w-3.5" />}
              </Button>

              {post.onChainTxHash && (
                <a
                  href={`https://monvision.io/tx/${post.onChainTxHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] text-muted-foreground hover:text-violet-600 transition-colors font-mono flex items-center gap-0.5"
                >
                  {post.onChainTxHash.slice(0, 6)}…{post.onChainTxHash.slice(-4)}
                  <ExternalLink className="h-2.5 w-2.5" />
                </a>
              )}
            </>
          )}
        </div>
      </CardFooter>
    </Card>
  );
}
