import { useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import type { Post } from "@workspace/api-client-react";
import { useUnlikePost, getListPostsQueryKey, getGetPostQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Heart, ExternalLink, Loader2 } from "lucide-react";
import { useContractActions } from "@/lib/useContractActions";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export function PostCard({ post }: { post: Post }) {
  const queryClient = useQueryClient();
  const unlikePost = useUnlikePost();
  const { contractDeployed, likePostOnChain } = useContractActions();

  const [liking, setLiking] = useState(false);
  const [optimisticLiked, setOptimisticLiked] = useState<boolean | null>(null);
  const [optimisticCount, setOptimisticCount] = useState<number | null>(null);

  const isLiked = optimisticLiked !== null ? optimisticLiked : post.likedByMe;
  const likeCount = optimisticCount !== null ? optimisticCount : (post.likeCount ?? 0);

  const handleLikeToggle = async () => {
    if (liking) return;
    setLiking(true);

    const wasLiked = isLiked;

    if (!wasLiked) {
      // Optimistic update
      setOptimisticLiked(true);
      setOptimisticCount(likeCount + 1);

      let txHash: string | null = null;

      // 1. Sign on-chain like (non-blocking on failure)
      if (contractDeployed) {
        try {
          txHash = await likePostOnChain(post.id);
        } catch {
          // User declined or already liked on chain — continue with DB update
        }
      }

      // 2. Record in DB with optional txHash
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
        // Revert optimistic update
        setOptimisticLiked(wasLiked);
        setOptimisticCount(likeCount);
      }
    } else {
      // Unlike — on-chain likes are immutable, only un-like in DB
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

  const initials = post.authorName ? post.authorName.slice(0, 2).toUpperCase() : "??";
  const explorerUrl = post.onChainTxHash
    ? `https://explorer.monad.xyz/tx/${post.onChainTxHash}`
    : null;

  return (
    <Card className="hover-elevate overflow-hidden transition-all duration-200 group">
      {/* Mandatory image at the top */}
      {post.imageUrl && (
        <div className="w-full overflow-hidden bg-muted">
          <img
            src={post.imageUrl}
            alt="Post image"
            className="w-full max-h-[480px] object-cover group-hover:scale-[1.005] transition-transform duration-300"
          />
        </div>
      )}

      <CardHeader className="p-4 pb-2 flex flex-row items-center gap-3">
        <Link href={`/profile/${post.authorId}`}>
          <Avatar className="h-9 w-9 cursor-pointer ring-2 ring-transparent hover:ring-primary/30 transition-all">
            <AvatarImage src={post.authorAvatarUrl || ""} alt={post.authorName || "User"} />
            <AvatarFallback className="bg-primary/10 text-primary font-medium text-xs">
              {initials}
            </AvatarFallback>
          </Avatar>
        </Link>
        <div className="flex flex-col flex-1 min-w-0">
          <Link href={`/profile/${post.authorId}`} className="font-semibold text-sm hover:underline">
            {post.authorName}
          </Link>
          <div className="flex items-center text-xs text-muted-foreground gap-1">
            <span>@{post.authorUsername}</span>
            <span>·</span>
            <span>{formatDistanceToNow(new Date(post.createdAt), { addSuffix: true })}</span>
          </div>
        </div>

        {/* On-chain anchor badge */}
        {explorerUrl && (
          <a
            href={explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-shrink-0 flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 hover:bg-violet-200 transition-colors"
            title={`View on Monad Explorer`}
          >
            On Monad
            <ExternalLink className="h-2.5 w-2.5" />
          </a>
        )}
      </CardHeader>

      {post.content && (
        <CardContent className="px-4 pb-2 pt-0">
          <p className="whitespace-pre-wrap text-foreground/90 leading-relaxed text-sm">
            {post.content}
          </p>
        </CardContent>
      )}

      <CardFooter className="p-4 pt-2 border-t border-border/50 bg-muted/20 flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          className={`gap-1.5 rounded-full transition-colors ${
            isLiked
              ? "text-red-500 hover:text-red-600 hover:bg-red-50"
              : "text-muted-foreground hover:text-foreground"
          }`}
          onClick={handleLikeToggle}
          disabled={liking}
        >
          {liking && !isLiked ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Heart className={`h-4 w-4 ${isLiked ? "fill-current" : ""}`} />
          )}
          <span className="font-medium">{likeCount}</span>
        </Button>

        {post.onChainTxHash && (
          <a
            href={`https://explorer.monad.xyz/tx/${post.onChainTxHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-muted-foreground hover:text-violet-600 transition-colors font-mono"
          >
            {post.onChainTxHash.slice(0, 6)}…{post.onChainTxHash.slice(-4)}
          </a>
        )}
      </CardFooter>
    </Card>
  );
}
