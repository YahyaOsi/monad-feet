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
  Share2, Check, Lock, Crown
} from "lucide-react";
import { useContractActions } from "@/lib/useContractActions";
import { useOnChainPostLikeCount, useIsPostLikedOnChain } from "@/lib/useOnChain";
import { CONTRACT_DEPLOYED } from "@/lib/contract";
import { useUser } from "@/context/UserContext";
import { useShareLoginPrompt } from "@/hooks/useShareLoginPrompt";
import { usePostLike } from "@/hooks/usePostLike";
import { usePostPublication } from "@/hooks/usePostPublication";
import { PublicationRecovery } from "@/components/post/PublicationRecovery";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export function PostCard({ post, onRequireLogin }: { post: Post; onRequireLogin?: () => void }) {
  const queryClient = useQueryClient();
  const { address } = useAccount();
  const [, navigate] = useLocation();
  const { user } = useUser();
  const { promptLogin: openLoginPrompt, dialog: loginDialog } = useShareLoginPrompt();
  const promptLogin = onRequireLogin ?? openLoginPrompt;
  const publication = usePostPublication();
  const [publicationError, setPublicationError] = useState<string | null>(null);
  const [recoveryHash, setRecoveryHash] = useState("");
  const [copied, setCopied] = useState(false);
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);

  // A locked shell must never load the original private image, even blurred.
  const isBlurred = (post as Post & { isPaid?: boolean; isSubscribedToAuthor?: boolean }).isPaid
    && !(post as Post & { isPaid?: boolean; isSubscribedToAuthor?: boolean }).isSubscribedToAuthor;
  const { isLiked, likeCount, usingChainCount, liking, handleLikeToggle } = usePostLike(post, promptLogin, !!isBlurred);

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

  return (
    <Card className="overflow-hidden transition-all duration-200 group hover:shadow-md">
      {!post.onChainTxHash && user?.id === post.authorId && (
        <div className="border-b bg-amber-500/10 p-3 space-y-2">
          <p className="text-sm">This post is private until confirmed on Monad. Finish publishing checks for an existing transaction before asking you to sign.</p>
          <Button size="sm" disabled={publication.busy} onClick={async () => {
            setPublicationError(null);
            try {
              await publication.publish({ legacyPostId: post.id, content: post.content ?? "", imageUrl: post.imageUrl ?? "", isPaid: !!post.isPaid }, recoveryHash || undefined);
              setRecoveryHash("");
              void queryClient.invalidateQueries({ queryKey: getListPostsQueryKey() });
            } catch (error) { setPublicationError(error instanceof Error ? error.message : "Publication failed."); }
          }}>{publication.busy ? "Checking Monad…" : "Finish publishing"}</Button>
          {publicationError && publication.draft?.postId === post.id && <PublicationRecovery
            draft={publication.draft} busy={publication.busy} onDiscard={publication.discard}
            onError={setPublicationError} transactionHash={recoveryHash} onTransactionHashChange={setRecoveryHash} />}
          {publicationError && <p className="text-xs text-destructive" role="alert">{publicationError}</p>}
        </div>
      )}
      {/* Post image */}
      {isBlurred ? (
          <div className="relative w-full overflow-hidden bg-muted aspect-video select-none">
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-gradient-to-br from-primary/20 to-background">
              <div className="p-3 bg-background/90 backdrop-blur-sm rounded-full shadow-lg">
                <Lock className="h-7 w-7 text-primary" />
              </div>
              <p className="font-bold text-base">Exclusive content</p>
              <p className="text-muted-foreground text-xs">Subscribe to unlock this post</p>
              <Button
                size="sm"
                className="gap-1.5 mt-1 bg-primary hover:bg-primary/90 shadow-lg"
                onClick={() => user ? navigate(`/profile/${post.authorId}`) : promptLogin()}
                data-testid={`button-subscribe-post-${post.id}`}
              >
                <Crown className="h-3.5 w-3.5" />
                Subscribe to @{post.authorUsername}
              </Button>
            </div>
          </div>
      ) : post.imageUrl ? (
          <Link href={`/post/${post.id}`}>
            <div className="w-full overflow-hidden bg-muted cursor-pointer">
              {failedImageUrl === post.imageUrl ? (
                <div className="p-6 text-sm text-muted-foreground text-center" role="status">
                  <p>Image could not load.</p>
                  <Button variant="outline" size="sm" className="mt-2" onClick={(event) => {
                    event.preventDefault(); event.stopPropagation(); setFailedImageUrl(null);
                  }}>Retry image</Button>
                </div>
              ) : <img
                src={post.imageUrl}
                loading="lazy"
                decoding="async"
                alt="Post image"
                className="w-full max-h-[480px] object-cover group-hover:scale-[1.005] transition-transform duration-300"
                onError={() => setFailedImageUrl(post.imageUrl ?? null)}
              />}
            </div>
          </Link>
      ) : null}

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
            <Link href={`/profile/${post.authorId}`} className="font-semibold text-sm hover:underline break-words [overflow-wrap:anywhere]">
              {post.authorName}
            </Link>
            {(post as Post & { isPaid?: boolean }).isPaid && (
              <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200 flex-shrink-0">
                <Crown className="h-2.5 w-2.5" />
                Exclusive
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center text-xs text-muted-foreground gap-1 [overflow-wrap:anywhere]">
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
            title="Anchored on Monad"
          >
            <Shield className="h-2.5 w-2.5" />
            On Monad
            <ExternalLink className="h-2.5 w-2.5" />
          </a>
        )}
      </CardHeader>

      {!isBlurred && post.content && (
        <CardContent className="px-4 pb-2 pt-0">
            <Link href={`/post/${post.id}`}>
              <p className="whitespace-pre-wrap text-foreground/90 leading-relaxed text-sm cursor-pointer hover:text-foreground transition-colors">{post.content}</p>
            </Link>
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
            disabled={liking || isBlurred || !post.onChainTxHash}
            aria-label={user ? (isLiked ? "Sync confirmed like; likes cannot be undone" : "Like post on Monad") : "Sign in to like post"}
            data-testid={`button-like-post-${post.id}`}
          >
            <Heart className={`h-4 w-4 ${isLiked ? "fill-current" : ""}`} />
            {liking && <Loader2 className="h-3 w-3 animate-spin" />}
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
              onClick={() => user ? navigate(`/profile/${post.authorId}`) : promptLogin()}
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
      {!onRequireLogin && loginDialog}
    </Card>
  );
}
