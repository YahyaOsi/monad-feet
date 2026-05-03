import { useState, useRef, useCallback, useEffect } from "react";
import { useUser } from "@/context/UserContext";
import { useListPosts, useGetFeedSummary, useCreatePost } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { PostCard } from "@/components/post/PostCard";
import {
  Plus, Users, Heart, MessageSquare, ImageIcon, X, Loader2,
  Link2, CheckCircle2, Flame, TrendingUp, ArrowUp, Zap, Crown, Lock
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { getListPostsQueryKey, getGetFeedSummaryQueryKey } from "@workspace/api-client-react";
import { useContractActions } from "@/lib/useContractActions";
import { useActivityFeed, type LivePost } from "@/hooks/usePresence";
import type { Post } from "@workspace/api-client-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function requestUploadUrl(file: File): Promise<{ uploadURL: string; objectPath: string }> {
  const wallet = localStorage.getItem("mf_wallet_address") ?? "";
  const res = await fetch(`${BASE}/api/storage/uploads/request-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-wallet-address": wallet },
    body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
  });
  if (!res.ok) throw new Error("Failed to get upload URL");
  return res.json();
}

async function uploadToGCS(uploadURL: string, file: File): Promise<void> {
  const res = await fetch(uploadURL, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
  if (!res.ok) throw new Error("Upload failed");
}

async function anchorPostOnDB(postId: number, txHash: string): Promise<void> {
  const wallet = localStorage.getItem("mf_wallet_address") ?? "";
  await fetch(`${BASE}/api/posts/${postId}/anchor`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "x-wallet-address": wallet },
    body: JSON.stringify({ txHash }),
  });
}

function livePostToPost(p: LivePost): Post {
  return {
    id: p.id,
    content: p.content ?? "",
    imageUrl: p.imageUrl ?? null,
    authorId: p.authorId,
    authorName: p.authorName ?? null,
    authorUsername: p.authorUsername ?? null,
    authorAvatarUrl: p.authorAvatarUrl ?? null,
    onChainTxHash: p.onChainTxHash ?? null,
    likeCount: p.likeCount,
    likedByMe: p.likedByMe,
    createdAt: typeof p.createdAt === "string" ? p.createdAt : p.createdAt.toISOString(),
  };
}

type PostStep = "idle" | "uploading" | "saving" | "signing" | "done" | "error";
type SortMode = "latest" | "top";

export default function Feed() {
  const { user } = useUser();
  const queryClient = useQueryClient();
  const { data: feedPage, isLoading: feedLoading } = useListPosts({});
  const { data: summary } = useGetFeedSummary();
  const createPost = useCreatePost();
  const { contractDeployed, createPostOnChain } = useContractActions();

  const [isComposeOpen, setIsComposeOpen] = useState(false);
  const [content, setContent] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [postStep, setPostStep] = useState<PostStep>("idle");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isExclusive, setIsExclusive] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("latest");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const feedTopRef = useRef<HTMLDivElement>(null);

  // Live prepended posts from WS (flushed by clicking banner)
  const [livePosts, setLivePosts] = useState<Post[]>([]);

  // Activity feed hook — live like updates, pending new posts, anchor updates
  const { pendingCount, flushPending, likeUpdates, anchorUpdates } = useActivityFeed(user?.id);

  const handleFlushPending = useCallback(() => {
    const flushed = flushPending();
    setLivePosts((prev) => [...flushed.map(livePostToPost), ...prev]);
    feedTopRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [flushPending]);

  // Merge live posts + server posts, deduplicate
  const serverPosts = feedPage?.posts ?? [];
  const liveIds = new Set(livePosts.map((p) => p.id));
  const mergedPosts = [...livePosts, ...serverPosts.filter((p) => !liveIds.has(p.id))];

  // Apply live like-count and anchor overrides
  const enrichedPosts: Post[] = mergedPosts.map((p) => ({
    ...p,
    likeCount: likeUpdates.has(p.id) ? (likeUpdates.get(p.id) ?? p.likeCount) : p.likeCount,
    onChainTxHash: anchorUpdates.has(p.id) ? (anchorUpdates.get(p.id) ?? p.onChainTxHash) : p.onChainTxHash,
  }));

  const sortedPosts = sortMode === "top"
    ? [...enrichedPosts].sort((a, b) => (b.likeCount ?? 0) - (a.likeCount ?? 0))
    : enrichedPosts;

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { setUploadError("Please select an image file."); return; }
    setUploadError(null);
    setImageFile(file);
    const reader = new FileReader();
    reader.onload = () => setImagePreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const clearImage = () => {
    setImageFile(null);
    setImagePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleCreatePost = async () => {
    if (!imageFile || !user) return;
    setUploadError(null);
    try {
      setPostStep("uploading");
      const { uploadURL, objectPath } = await requestUploadUrl(imageFile);
      await uploadToGCS(uploadURL, imageFile);
      const imageUrl = `${BASE}/api/storage${objectPath}`;

      setPostStep("saving");
      const post = await createPost.mutateAsync({
        data: { content: content.trim() || "", imageUrl, authorWalletAddress: user.walletAddress, isPaid: isExclusive },
      });

      if (contractDeployed && post?.id) {
        setPostStep("signing");
        try {
          const contentUri = `mf:${post.id}:${objectPath}`;
          const txHash = await createPostOnChain(post.id, contentUri);
          if (txHash) await anchorPostOnDB(post.id, txHash);
        } catch { /* user declined */ }
      }

      setPostStep("done");
      setIsComposeOpen(false);
      setContent("");
      clearImage();
      queryClient.invalidateQueries({ queryKey: getListPostsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetFeedSummaryQueryKey() });
      setTimeout(() => setPostStep("idle"), 3000);
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Failed to post. Please try again.");
      setPostStep("error");
    }
  };

  const handleOpenChange = (open: boolean) => {
    setIsComposeOpen(open);
    if (!open) { clearImage(); setContent(""); setUploadError(null); setPostStep("idle"); setIsExclusive(false); }
  };

  const isPosting = postStep === "uploading" || postStep === "saving" || postStep === "signing";

  const postButtonLabel = () => {
    if (postStep === "uploading") return "Uploading image...";
    if (postStep === "saving") return "Saving post...";
    if (postStep === "signing") return "Sign on Monad...";
    return contractDeployed ? "Post & Sign on Monad" : "Post";
  };

  return (
    <div className="space-y-6 pb-20">
      <div ref={feedTopRef} className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Feed</h1>
        <div className="flex items-center gap-2">
          {postStep === "done" && (
            <div className="flex items-center gap-1.5 text-xs text-green-600 font-medium">
              <CheckCircle2 className="h-3.5 w-3.5" /> Posted{contractDeployed ? " & anchored on Monad" : ""}
            </div>
          )}
          {/* Live indicator */}
          <div className="flex items-center gap-1 text-[11px] font-medium text-green-600 bg-green-50 border border-green-200 px-2 py-1 rounded-full">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-green-500" />
            </span>
            Live
          </div>
        </div>
      </div>

      {summary && (
        <div className="grid grid-cols-3 gap-4">
          <Card className="bg-primary/5 border-none shadow-none">
            <CardContent className="p-4 flex items-center gap-4">
              <div className="p-3 bg-primary/10 rounded-full text-primary">
                <MessageSquare className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Posts</p>
                <p className="text-2xl font-bold">{summary.totalPosts + livePosts.length}</p>
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
      )}

      {/* Sort toggle */}
      <div className="flex items-center gap-2 border-b border-border pb-2">
        <button
          onClick={() => setSortMode("latest")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
            sortMode === "latest"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-muted"
          }`}
        >
          <Flame className="h-3.5 w-3.5" /> Latest
        </button>
        <button
          onClick={() => setSortMode("top")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
            sortMode === "top"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-muted"
          }`}
        >
          <TrendingUp className="h-3.5 w-3.5" /> Top
        </button>
        <div className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground">
          <Zap className="h-3 w-3 text-yellow-500" /> Likes update live
        </div>
      </div>

      {/* ── New posts banner ── */}
      {pendingCount > 0 && (
        <button
          onClick={handleFlushPending}
          className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-primary text-primary-foreground font-semibold text-sm shadow-lg hover:bg-primary/90 transition-all animate-in slide-in-from-top-2 duration-300"
        >
          <ArrowUp className="h-4 w-4" />
          {pendingCount} new {pendingCount === 1 ? "post" : "posts"} — tap to load
        </button>
      )}

      <div className="space-y-4">
        {feedLoading ? (
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <Card key={i} className="animate-pulse">
                <CardContent className="h-64 p-6" />
              </Card>
            ))}
          </div>
        ) : sortedPosts.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <ImageIcon className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No posts yet.</p>
            <p className="text-sm mt-1">Be the first to share a moment!</p>
          </div>
        ) : (
          sortedPosts.map((post) => <PostCard key={post.id} post={post} />)
        )}
      </div>

      {/* Compose dialog */}
      <Dialog open={isComposeOpen} onOpenChange={handleOpenChange}>
        <DialogTrigger asChild>
          <Button
            size="icon"
            className="fixed bottom-20 md:bottom-8 right-4 md:right-8 h-14 w-14 rounded-full shadow-lg hover:shadow-xl transition-all"
          >
            <Plus className="h-6 w-6" />
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create a Post</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              {imagePreview ? (
                <div className="relative rounded-xl overflow-hidden bg-muted aspect-video">
                  <img src={imagePreview} alt="Preview" className="w-full h-full object-cover" />
                  <button
                    onClick={clearImage}
                    className="absolute top-2 right-2 bg-black/60 text-white rounded-full p-1 hover:bg-black/80 transition-colors"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full rounded-xl border-2 border-dashed border-border hover:border-primary/50 bg-muted/30 hover:bg-primary/5 transition-colors aspect-video flex flex-col items-center justify-center gap-3 cursor-pointer"
                >
                  <div className="p-3 bg-primary/10 rounded-full">
                    <ImageIcon className="h-7 w-7 text-primary" />
                  </div>
                  <div className="text-center">
                    <p className="font-semibold text-sm">Add an image</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Required — click to browse</p>
                  </div>
                </button>
              )}
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelect} />
            </div>

            <Textarea
              placeholder="Add a caption... (optional)"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="min-h-[80px] resize-none"
            />

            {/* Exclusive post toggle */}
            <button
              type="button"
              onClick={() => setIsExclusive((v) => !v)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border-2 transition-all text-sm font-medium ${
                isExclusive
                  ? "border-amber-400 bg-amber-50 text-amber-800"
                  : "border-border bg-muted/30 text-muted-foreground hover:border-primary/30 hover:bg-muted/50"
              }`}
            >
              <div className={`p-1.5 rounded-lg ${isExclusive ? "bg-amber-200 text-amber-700" : "bg-muted text-muted-foreground"}`}>
                {isExclusive ? <Lock className="h-4 w-4" /> : <Crown className="h-4 w-4" />}
              </div>
              <div className="flex-1 text-left">
                <p className="font-semibold leading-tight">{isExclusive ? "Exclusive post" : "Make exclusive"}</p>
                <p className="text-xs font-normal mt-0.5 opacity-75">
                  {isExclusive
                    ? "Only your subscribers can see this — others see it blurred"
                    : "All followers see this — toggle to restrict to subscribers only"}
                </p>
              </div>
              <div className={`h-5 w-9 rounded-full transition-all flex-shrink-0 ${isExclusive ? "bg-amber-500" : "bg-muted-foreground/30"}`}>
                <div className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${isExclusive ? "translate-x-4" : "translate-x-0"}`} />
              </div>
            </button>

            {contractDeployed && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 rounded-lg px-3 py-2">
                <Link2 className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                This post will be anchored on <strong>Monad Mainnet</strong> — your wallet will prompt for a signature.
              </div>
            )}

            {postStep === "signing" && (
              <div className="flex items-center gap-2 text-xs text-violet-700 bg-violet-50 rounded-lg px-3 py-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin flex-shrink-0" />
                Check your wallet — sign the transaction to anchor this post on Monad…
              </div>
            )}

            {uploadError && <p className="text-sm text-destructive">{uploadError}</p>}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={isPosting}>Cancel</Button>
              <Button onClick={handleCreatePost} disabled={!imageFile || isPosting}>
                {isPosting
                  ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />{postButtonLabel()}</>
                  : postButtonLabel()}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
