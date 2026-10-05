import { useState } from "react";
import { Link, useParams, useLocation } from "wouter";
import { useUser } from "@/context/UserContext";
import { useGetPost } from "@workspace/api-client-react";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowLeft, Heart, ExternalLink, Loader2, Link2, Shield,
  MessageSquare, Share2, Check, Trash2, Send, Lock
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useAccount } from "wagmi";
import { useOnChainPostLikeCount, useIsPostLikedOnChain } from "@/lib/useOnChain";
import { useContractActions } from "@/lib/useContractActions";
import { CONTRACT_DEPLOYED } from "@/lib/contract";
import { useQueryClient } from "@tanstack/react-query";
import { getGetPostQueryKey, getListPostsQueryKey } from "@workspace/api-client-react";
import { usePageMetadata } from "@/hooks/usePageMetadata";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type Comment = {
  id: number;
  postId: number;
  authorId: number;
  authorName?: string | null;
  authorUsername?: string | null;
  authorAvatarUrl?: string | null;
  content: string;
  createdAt: string;
};

async function fetchComments(postId: number, isSignedIn: boolean): Promise<Comment[]> {
  const res = await fetch(`${BASE}/api/posts/${postId}/comments`, {
    credentials: isSignedIn ? "include" : "omit",
  });
  if (!res.ok) throw new Error(`Could not load comments (HTTP ${res.status}).`);
  return res.json();
}

async function postComment(postId: number, content: string): Promise<Comment | null> {
  const wallet = localStorage.getItem("mf_wallet_address") ?? "";
  const res = await fetch(`${BASE}/api/posts/${postId}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-wallet-address": wallet },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) return null;
  return res.json();
}

async function deleteComment(commentId: number): Promise<void> {
  const wallet = localStorage.getItem("mf_wallet_address") ?? "";
  await fetch(`${BASE}/api/comments/${commentId}`, {
    method: "DELETE",
    headers: { "x-wallet-address": wallet },
  });
}

export default function PostDetail({ promptLogin }: { promptLogin: () => void }) {
  const params = useParams();
  const postId = Number(params.postId);
  const [, navigate] = useLocation();
  const { user } = useUser();
  const viewerScope = user ? `${user.id}:${user.walletAddress.toLowerCase()}` : "guest";
  const { address } = useAccount();
  const queryClient = useQueryClient();
  const { contractDeployed, likePostOnChain } = useContractActions();

  const { data: post, isLoading, isError: postError, error: postQueryError } = useGetPost(postId, {
    query: {
      enabled: Number.isSafeInteger(postId) && postId > 0,
      queryKey: [...getGetPostQueryKey(postId), viewerScope],
    },
    request: { credentials: user ? "include" : "omit" },
  });

  const { data: chainLikeCount } = useOnChainPostLikeCount(postId);
  const { data: chainLikedByMe } = useIsPostLikedOnChain(postId, address);

  const [liking, setLiking] = useState(false);
  const [optimisticLiked, setOptimisticLiked] = useState<boolean | null>(null);
  const [optimisticCount, setOptimisticCount] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);

  const [comments, setComments] = useState<Comment[] | null>(null);
  const [commentsLoaded, setCommentsLoaded] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loadingComments, setLoadingComments] = useState(false);
  const [commentsError, setCommentsError] = useState<string | null>(null);

  usePageMetadata(
    post ? `Post by @${post.authorUsername ?? post.authorName ?? "creator"} on Monad Feet` : "Monad Feet post",
    (post as (typeof post & { isPaid?: boolean }) | undefined)?.isPaid
      ? "An exclusive post on Monad Feet. Visit the creator profile to learn more."
      : (post?.content || "A public post on Monad Feet."),
  );

  const isLiked = optimisticLiked !== null
    ? optimisticLiked
    : (CONTRACT_DEPLOYED && chainLikedByMe !== undefined ? chainLikedByMe : (post?.likedByMe ?? false));

  const likeCount = optimisticCount !== null
    ? optimisticCount
    : (CONTRACT_DEPLOYED && chainLikeCount !== undefined ? Number(chainLikeCount) : (post?.likeCount ?? 0));

  const handleLikeToggle = async () => {
    if (!user) { promptLogin(); return; }
    if (liking || !post || ((post as typeof post & { isPaid?: boolean; isSubscribedToAuthor?: boolean }).isPaid && !(post as typeof post & { isSubscribedToAuthor?: boolean }).isSubscribedToAuthor)) return;
    setLiking(true);
    const wasLiked = isLiked;

    if (!wasLiked) {
      setOptimisticLiked(true);
      setOptimisticCount(likeCount + 1);
      let txHash: string | null = null;
      if (contractDeployed) {
        try { txHash = await likePostOnChain(post.id); } catch { /* skip */ }
      }
      try {
        const wallet = localStorage.getItem("mf_wallet_address") ?? "";
        const response = await fetch(`${BASE}/api/posts/${post.id}/like`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-wallet-address": wallet },
          body: JSON.stringify({ txHash }),
        });
        if (!response.ok) throw new Error(`Like failed (HTTP ${response.status}).`);
        queryClient.invalidateQueries({ queryKey: getGetPostQueryKey(post.id) });
        queryClient.invalidateQueries({ queryKey: getListPostsQueryKey() });
      } catch {
        setOptimisticLiked(wasLiked);
        setOptimisticCount(likeCount);
      }
    } else {
      setOptimisticLiked(false);
      setOptimisticCount(Math.max(0, likeCount - 1));
      try {
        const wallet = localStorage.getItem("mf_wallet_address") ?? "";
        const response = await fetch(`${BASE}/api/posts/${post.id}/like`, {
          method: "DELETE",
          headers: { "x-wallet-address": wallet },
        });
        if (!response.ok) throw new Error(`Unlike failed (HTTP ${response.status}).`);
        queryClient.invalidateQueries({ queryKey: getGetPostQueryKey(post.id) });
        queryClient.invalidateQueries({ queryKey: getListPostsQueryKey() });
      } catch {
        setOptimisticLiked(wasLiked);
        setOptimisticCount(likeCount);
      }
    }
    setLiking(false);
  };

  const handleShare = async () => {
    const url = `${window.location.origin}${window.location.pathname}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: `Post by @${post?.authorUsername}`, url });
      } else {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch { /* dismissed */ }
  };

  const loadComments = async () => {
    if (commentsLoaded || loadingComments) return;
    setLoadingComments(true);
    setCommentsError(null);
    try {
      const data = await fetchComments(postId, !!user);
      setComments(data);
      setCommentsLoaded(true);
    } catch (error) {
      setCommentsError(error instanceof Error ? error.message : "Could not load comments.");
    } finally {
      setLoadingComments(false);
    }
  };

  const handleSubmitComment = async () => {
    if (!user) { promptLogin(); return; }
    if (!commentText.trim() || submitting) return;
    setSubmitting(true);
    const newComment = await postComment(postId, commentText.trim());
    if (newComment) {
      setComments((prev) => [newComment, ...(prev ?? [])]);
      setCommentText("");
    }
    setSubmitting(false);
  };

  const handleDeleteComment = async (commentId: number) => {
    if (!user) { promptLogin(); return; }
    await deleteComment(commentId);
    setComments((prev) => (prev ?? []).filter((c) => c.id !== commentId));
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Link href="/feed" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to Feed
        </Link>
        <Card className="animate-pulse h-96" role="status" aria-label="Loading post" />
      </div>
    );
  }
  if (postError && (postQueryError as { status?: number } | null)?.status !== 404) {
    return <div className="py-12 text-center" role="alert">Could not load this post. Please try again.</div>;
  }
  if (!post) return <div className="py-12 text-center">Post not found.</div>;

  const isChainVerified = !!post.onChainTxHash;
  const usingChainCount = CONTRACT_DEPLOYED && chainLikeCount !== undefined;
  const initials = post.authorName?.slice(0, 2).toUpperCase() ?? "??";
  const locked = (post as typeof post & { isPaid?: boolean; isSubscribedToAuthor?: boolean }).isPaid
    && !(post as typeof post & { isSubscribedToAuthor?: boolean }).isSubscribedToAuthor;

  return (
    <div className="space-y-4 pb-20 max-w-2xl mx-auto">
      <Link href="/feed" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="h-4 w-4" /> Back to Feed
      </Link>

      <Card className="overflow-hidden">
        {/* Image */}
        {locked ? (
          <div className="aspect-video bg-gradient-to-br from-primary/20 to-muted flex flex-col items-center justify-center gap-3 text-center p-4" data-testid="status-locked-post">
            <Lock className="h-8 w-8 text-primary" />
            <p className="font-semibold">Exclusive content</p>
            <p className="text-sm text-muted-foreground">Subscribe to unlock this post.</p>
            <Button
              data-testid="button-subscribe-detail"
              onClick={() => user ? navigate(`/profile/${post.authorId}`) : promptLogin()}
            >
              Subscribe to @{post.authorUsername}
            </Button>
          </div>
        ) : post.imageUrl ? (
          <div className="w-full bg-muted">
            {failedImageUrl === post.imageUrl ? (
              <p className="p-6 text-sm text-muted-foreground text-center" role="status">Image unavailable. Check your subscription and refresh the page.</p>
            ) : <img
              src={post.imageUrl}
              alt="Post"
              className="w-full max-h-[600px] object-cover"
              onError={() => setFailedImageUrl(post.imageUrl ?? null)}
            />}
          </div>
        ) : null}

        <CardHeader className="p-5 pb-3 flex flex-row items-center gap-3">
          <Link href={`/profile/${post.authorId}`}>
            <Avatar className="h-11 w-11 cursor-pointer ring-2 ring-transparent hover:ring-primary/30 transition-all">
              <AvatarImage src={post.authorAvatarUrl ?? ""} />
              <AvatarFallback className="bg-primary/10 text-primary font-bold">{initials}</AvatarFallback>
            </Avatar>
          </Link>
          <div className="flex-1">
            <Link href={`/profile/${post.authorId}`} className="font-semibold hover:underline">{post.authorName}</Link>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
              <span>@{post.authorUsername}</span>
              <span>·</span>
              <span>{formatDistanceToNow(new Date(post.createdAt), { addSuffix: true })}</span>
            </div>
          </div>
          {isChainVerified && post.onChainTxHash && (
            <a
              href={`https://monvision.io/tx/${post.onChainTxHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full bg-violet-100 text-violet-700 border border-violet-200 hover:bg-violet-200 transition-colors"
            >
              <Shield className="h-2.5 w-2.5" /> On Monad <ExternalLink className="h-2.5 w-2.5" />
            </a>
          )}
        </CardHeader>

        {!locked && post.content && (
          <CardContent className="px-5 pb-3 pt-0">
            <p className="whitespace-pre-wrap text-foreground/90 leading-relaxed">{post.content}</p>
          </CardContent>
        )}

        {!locked && <CardFooter className="p-4 border-t border-border/50 bg-muted/20 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleLikeToggle}
              disabled={liking}
              className={`gap-1.5 rounded-full ${isLiked ? "text-red-500 hover:text-red-600 hover:bg-red-50" : "text-muted-foreground"}`}
            >
              {liking ? <Loader2 className="h-4 w-4 animate-spin" /> : (
                <Heart className={`h-4 w-4 ${isLiked ? "fill-current" : ""}`} />
              )}
              <span className="font-semibold">{likeCount}</span>
            </Button>
            {usingChainCount && (
              <span className="flex items-center gap-0.5 text-[10px] text-violet-600 font-medium">
                <Link2 className="h-2.5 w-2.5" /> chain
              </span>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={loadComments}
              className="gap-1.5 rounded-full text-muted-foreground hover:text-foreground"
            >
              <MessageSquare className="h-4 w-4" />
              <span className="font-semibold">{(comments ?? []).length || ""}</span>
              {!commentsLoaded && <span className="text-xs">Comments</span>}
            </Button>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleShare}
            className="gap-1.5 rounded-full text-muted-foreground hover:text-foreground"
          >
            {copied ? <Check className="h-4 w-4 text-green-500" /> : <Share2 className="h-4 w-4" />}
            {copied ? "Copied!" : "Share"}
          </Button>
        </CardFooter>}
        {locked && (
          <CardFooter className="p-4 border-t border-border/50 bg-muted/20 flex justify-end">
            <Button variant="ghost" size="sm" onClick={handleShare} className="gap-1.5">
              {copied ? <Check className="h-4 w-4 text-green-500" /> : <Share2 className="h-4 w-4" />}
              {copied ? "Copied!" : "Share"}
            </Button>
          </CardFooter>
        )}
      </Card>

      {/* Comments section */}
      {!locked && (commentsLoaded || loadingComments || commentsError) && (
        <div className="space-y-4">
          <h2 className="font-semibold text-lg">
            {commentsLoaded ? `${comments?.length ?? 0} Comments` : "Comments"}
          </h2>

          {/* New comment input */}
          {commentsLoaded && user ? (
            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="flex gap-3">
                  <Avatar className="h-8 w-8 flex-shrink-0">
                    <AvatarImage src={user.avatarUrl ?? ""} />
                    <AvatarFallback className="text-xs bg-primary/10 text-primary">
                      {user.name?.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <Textarea
                    placeholder="Write a comment…"
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    className="min-h-[70px] resize-none flex-1"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSubmitComment();
                    }}
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button
                    size="sm"
                    onClick={handleSubmitComment}
                    disabled={!commentText.trim() || submitting}
                    className="gap-2"
                  >
                    {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    Post
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : commentsLoaded ? (
            <Button variant="outline" className="w-full" onClick={promptLogin} data-testid="button-sign-in-to-comment">
              Sign in to write a comment
            </Button>
          ) : null}

          {commentsError ? (
            <Card><CardContent className="py-6 text-center text-sm text-destructive" role="alert">{commentsError}</CardContent></Card>
          ) : loadingComments ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <Card key={i} className="animate-pulse h-20" />
              ))}
            </div>
          ) : !commentsLoaded ? null : comments?.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-muted-foreground">
                <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">No comments yet. Be the first!</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {(comments ?? []).map((comment) => (
                <Card key={comment.id}>
                  <CardContent className="p-4">
                    <div className="flex gap-3">
                      <Link href={`/profile/${comment.authorId}`}>
                        <Avatar className="h-8 w-8 flex-shrink-0 cursor-pointer">
                          <AvatarImage src={comment.authorAvatarUrl ?? ""} />
                          <AvatarFallback className="text-xs bg-primary/10 text-primary">
                            {comment.authorName?.slice(0, 2).toUpperCase() ?? "??"}
                          </AvatarFallback>
                        </Avatar>
                      </Link>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Link href={`/profile/${comment.authorId}`} className="font-semibold text-sm hover:underline">
                            {comment.authorName}
                          </Link>
                          <span className="text-xs text-muted-foreground">
                            {formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true })}
                          </span>
                        </div>
                        <p className="text-sm text-foreground/90 whitespace-pre-wrap">{comment.content}</p>
                      </div>
                      {user && (user.id === comment.authorId || user.id === post.authorId) && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive flex-shrink-0"
                          onClick={() => handleDeleteComment(comment.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {!locked && (!commentsLoaded || commentsError) && (
        <Button variant="outline" className="w-full gap-2" onClick={loadComments} disabled={loadingComments}>
          {loadingComments ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquare className="h-4 w-4" />}
          {loadingComments ? "Loading comments…" : commentsError ? "Retry loading comments" : "Load Comments"}
        </Button>
      )}
    </div>
  );
}
