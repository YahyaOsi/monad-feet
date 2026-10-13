import { useState, useEffect } from "react";
import { Link, useParams, useLocation } from "wouter";
import { useUser } from "@/context/UserContext";
import { useGetPost } from "@workspace/api-client-react";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowLeft, Heart, ExternalLink, Loader2, Link2, Shield,
  MessageSquare, Share2, Check, Trash2, Send, Lock, Reply
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useAccount } from "wagmi";
import { useOnChainPostLikeCount, useIsPostLikedOnChain } from "@/lib/useOnChain";
import { useContractActions } from "@/lib/useContractActions";
import { usePostLike } from "@/hooks/usePostLike";
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
  parentCommentId?: number | null;
};

type CommentNodeData = Comment & { children: CommentNodeData[] };

function buildTree(list: Comment[]): CommentNodeData[] {
  const byId = new Map<number, CommentNodeData>();
  for (const c of list) byId.set(c.id, { ...c, children: [] });
  const roots: CommentNodeData[] = [];
  for (const node of byId.values()) {
    const parent = node.parentCommentId != null ? byId.get(node.parentCommentId) : undefined;
    if (parent && parent !== node) parent.children.push(node); else roots.push(node);
  }
  const byNewest = (a: CommentNodeData, b: CommentNodeData) => +new Date(b.createdAt) - +new Date(a.createdAt);
  const byOldest = (a: CommentNodeData, b: CommentNodeData) => +new Date(a.createdAt) - +new Date(b.createdAt);
  const sortDeep = (nodes: CommentNodeData[]) => { for (const n of nodes) { n.children.sort(byOldest); sortDeep(n.children); } };
  roots.sort(byNewest); sortDeep(roots);
  return roots;
}

const MAX_INDENT_DEPTH = 4;

async function fetchComments(postId: number, isSignedIn: boolean): Promise<Comment[]> {
  const res = await fetch(`${BASE}/api/posts/${postId}/comments`, {
    credentials: isSignedIn ? "include" : "omit",
  });
  if (!res.ok) throw new Error(`Could not load comments (HTTP ${res.status}).`);
  return res.json();
}

async function postComment(postId: number, content: string, parentCommentId: number | null = null): Promise<Comment | null> {
  const wallet = localStorage.getItem("mf_wallet_address") ?? "";
  const res = await fetch(`${BASE}/api/posts/${postId}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-wallet-address": wallet },
    body: JSON.stringify({ content, parentCommentId }),
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

  const { data: post, isLoading, isError: postError, error: postQueryError } = useGetPost(postId, {
    query: {
      enabled: Number.isSafeInteger(postId) && postId > 0,
      queryKey: [...getGetPostQueryKey(postId), viewerScope],
    },
    request: { credentials: user ? "include" : "omit" },
  });

  const { isLiked, likeCount, usingChainCount, liking, handleLikeToggle } = usePostLike(post, promptLogin, !!(post?.isPaid && !post?.isSubscribedToAuthor));
  const [copied, setCopied] = useState(false);
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);

  const [comments, setComments] = useState<Comment[] | null>(null);
  const [commentsLoaded, setCommentsLoaded] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loadingComments, setLoadingComments] = useState(false);
  const [commentsError, setCommentsError] = useState<string | null>(null);
  const canLoadComments = !!post && !(post.isPaid && !post.isSubscribedToAuthor);
  useEffect(() => {
    let cancelled = false;
    setComments(null); setCommentsLoaded(false); setCommentsError(null);
    if (!canLoadComments) return;
    async function refresh(initial = false) {
      if (initial) setLoadingComments(true);
      try {
        const data = await fetchComments(postId, !!user);
        if (!cancelled) { setComments(data); setCommentsLoaded(true); setCommentsError(null); }
      } catch (error) {
        if (!cancelled) setCommentsError(error instanceof Error ? error.message : "Comments unavailable.");
      } finally { if (!cancelled) setLoadingComments(false); }
    }
    void refresh(true);
    const timer = setInterval(() => { void refresh(); }, 15_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [postId, viewerScope, canLoadComments]);

  usePageMetadata(
    post ? `Post by @${post.authorUsername ?? post.authorName ?? "creator"} on Monad Feet` : "Monad Feet post",
    (post as (typeof post & { isPaid?: boolean }) | undefined)?.isPaid
      ? "An exclusive post on Monad Feet. Visit the creator profile to learn more."
      : (post?.content || "A public post on Monad Feet."),
  );

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
    if ((commentsLoaded && !commentsError) || loadingComments) return;
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

  const handleReply = async (parentId: number, text: string): Promise<boolean> => {
    if (!user) { promptLogin(); return false; }
    const created = await postComment(postId, text, parentId);
    if (!created) return false;
    setComments((prev) => [...(prev ?? []), { ...created, parentCommentId: created.parentCommentId ?? parentId }]);
    return true;
  };

  const handleDeleteComment = async (commentId: number) => {
    if (!user) { promptLogin(); return; }
    await deleteComment(commentId);
    // Replies are promoted by the server, so reload instead of pruning locally.
    try {
      setComments(await fetchComments(postId, !!user));
    } catch {
      setComments((prev) => (prev ?? []).filter((c) => c.id !== commentId));
    }
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
              disabled={liking || !post.onChainTxHash}
              className={`gap-1.5 rounded-full ${isLiked ? "text-red-500 hover:text-red-600 hover:bg-red-50" : "text-muted-foreground"}`}
            >
              <Heart className={`h-4 w-4 ${isLiked ? "fill-current" : ""}`} />
              {liking && <Loader2 className="h-3 w-3 animate-spin" />}
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
            {copied ? "Copied" : "Share"}
          </Button>
        </CardFooter>}
        {locked && (
          <CardFooter className="p-4 border-t border-border/50 bg-muted/20 flex justify-end">
            <Button variant="ghost" size="sm" onClick={handleShare} className="gap-1.5">
              {copied ? <Check className="h-4 w-4 text-green-500" /> : <Share2 className="h-4 w-4" />}
              {copied ? "Copied" : "Share"}
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
                <p className="text-sm">No comments yet. Start the conversation.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {buildTree(comments ?? []).map((node) => (
                <CommentNode
                  key={node.id}
                  node={node}
                  depth={0}
                  canDelete={(c) => !!user && (user.id === c.authorId || user.id === post.authorId)}
                  onDelete={handleDeleteComment}
                  onReply={handleReply}
                  signedIn={!!user}
                  promptLogin={promptLogin}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {!locked && commentsError && (
        <Button variant="outline" className="w-full gap-2" onClick={loadComments} disabled={loadingComments}>
          {loadingComments ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquare className="h-4 w-4" />}
          {loadingComments ? "Loading comments…" : "Retry loading comments"}
        </Button>
      )}
    </div>
  );
}

function CommentNode({ node, depth, canDelete, onDelete, onReply, signedIn, promptLogin }: {
  node: CommentNodeData;
  depth: number;
  canDelete: (c: Comment) => boolean;
  onDelete: (id: number) => void;
  onReply: (parentId: number, text: string) => Promise<boolean>;
  signedIn: boolean;
  promptLogin: () => void;
}) {
  const [replying, setReplying] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const indent = depth > 0 && depth <= MAX_INDENT_DEPTH;

  const send = async () => {
    if (!text.trim() || sending) return;
    setSending(true); setFailed(false);
    const ok = await onReply(node.id, text.trim());
    setSending(false);
    if (ok) { setText(""); setReplying(false); } else setFailed(true);
  };

  return (
    <div className={indent ? "ml-3 sm:ml-5 border-l-2 border-primary/15 pl-3 sm:pl-4" : ""} data-testid={`comment-${node.id}`}>
      <div className={depth === 0 ? "rounded-xl border bg-card p-4" : "py-2"}>
        <div className="flex gap-3">
          <Link href={`/profile/${node.authorId}`}>
            <Avatar className={`${depth === 0 ? "h-8 w-8" : "h-7 w-7"} flex-shrink-0 cursor-pointer`}>
              <AvatarImage src={node.authorAvatarUrl ?? ""} />
              <AvatarFallback className="text-xs bg-primary/10 text-primary">
                {node.authorName?.slice(0, 2).toUpperCase() ?? "??"}
              </AvatarFallback>
            </Avatar>
          </Link>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <Link href={`/profile/${node.authorId}`} className="font-semibold text-sm hover:underline">{node.authorName}</Link>
              <span className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(node.createdAt), { addSuffix: true })}</span>
            </div>
            <p className="text-sm text-foreground/90 whitespace-pre-wrap break-words">{node.content}</p>
            <div className="mt-1.5 flex items-center gap-3 text-xs">
              <button
                type="button"
                className="inline-flex items-center gap-1 font-medium text-muted-foreground hover:text-primary"
                onClick={() => (signedIn ? setReplying((r) => !r) : promptLogin())}
                data-testid={`button-reply-${node.id}`}
              >
                <Reply className="h-3.5 w-3.5" /> Reply
              </button>
              {node.children.length > 0 && (
                <button
                  type="button"
                  className="font-medium text-muted-foreground hover:text-primary"
                  onClick={() => setCollapsed((c) => !c)}
                  data-testid={`button-toggle-replies-${node.id}`}
                >
                  {collapsed ? `Show ${node.children.length} ${node.children.length === 1 ? "reply" : "replies"}` : "Hide replies"}
                </button>
              )}
            </div>
            {replying && (
              <div className="mt-2 space-y-2">
                <Textarea
                  autoFocus
                  placeholder={`Reply to ${node.authorName ?? "this comment"}`}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  className="min-h-[60px] resize-none text-sm"
                  onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send(); }}
                  data-testid={`input-reply-${node.id}`}
                />
                {failed && <p className="text-xs text-destructive" role="alert">Reply did not post. Try again.</p>}
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={() => { setReplying(false); setText(""); }}>Cancel</Button>
                  <Button size="sm" className="gap-1.5" onClick={() => void send()} disabled={!text.trim() || sending} data-testid={`button-send-reply-${node.id}`}>
                    {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Reply
                  </Button>
                </div>
              </div>
            )}
          </div>
          {canDelete(node) && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-destructive flex-shrink-0"
              onClick={() => onDelete(node.id)}
              data-testid={`button-delete-comment-${node.id}`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
        {!collapsed && node.children.length > 0 && (
          <div className="mt-2">
            {node.children.map((child) => (
              <CommentNode key={child.id} node={child} depth={depth + 1} canDelete={canDelete} onDelete={onDelete} onReply={onReply} signedIn={signedIn} promptLogin={promptLogin} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
