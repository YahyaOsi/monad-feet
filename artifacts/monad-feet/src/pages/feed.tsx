import { useState, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { useUser } from "@/context/UserContext";
import { useListPosts } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { PostCard } from "@/components/post/PostCard";
import {
  Plus, ImageIcon, X, Loader2,
  Link2, CheckCircle2, Flame, TrendingUp, ArrowUp, Zap, Crown, Lock
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { getListPostsQueryKey, getGetFeedSummaryQueryKey } from "@workspace/api-client-react";
import { useContractActions } from "@/lib/useContractActions";
import { useActivityFeed } from "@/hooks/usePresence";
import { trackProductEvent } from "@/lib/analytics";
import type { Post } from "@workspace/api-client-react";
import { usePostPublication } from "@/hooks/usePostPublication";
import { PublicationRecovery } from "@/components/post/PublicationRecovery";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function requestUploadUrl(file: File): Promise<{ uploadURL: string; objectPath: string }> {
  const wallet = localStorage.getItem("mf_wallet_address") ?? "";
  const res = await fetch(`${BASE}/api/storage/uploads/request-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-wallet-address": wallet },
    body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? "Failed to get upload URL");
  }
  return res.json();
}

async function uploadToGCS(uploadURL: string, file: File): Promise<void> {
  const res = await fetch(uploadURL, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
  if (!res.ok) throw new Error("Upload failed");
}

type PostStep = "idle" | "uploading" | "saving" | "signing" | "done" | "error";
type SortMode = "latest" | "top";

export default function Feed() {
  const { user } = useUser();
  const queryClient = useQueryClient();
  const { data: feedPage, isLoading: feedLoading } = useListPosts({});
  const { contractDeployed } = useContractActions();
  const publication = usePostPublication();
  const postingLock = useRef(false);

  const [isComposeOpen, setIsComposeOpen] = useState(false);
  const [content, setContent] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [postStep, setPostStep] = useState<PostStep>("idle");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [recoveryHash, setRecoveryHash] = useState("");
  const [isExclusive, setIsExclusive] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("latest");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const feedTopRef = useRef<HTMLDivElement>(null);

  // Activity feed hook, live like updates, pending new posts, anchor updates
  const { pendingCount, flushPending, likeUpdates, anchorUpdates } = useActivityFeed(user?.id);

  const handleFlushPending = useCallback(() => {
    // Re-fetch the viewer-specific server projection; websocket payloads cannot
    // establish authorization to display a paid post's content or image.
    flushPending();
    queryClient.invalidateQueries({ queryKey: getListPostsQueryKey() });
    feedTopRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [flushPending, queryClient]);

  const serverPosts = feedPage?.posts ?? [];
  // Apply live like-count and anchor overrides
  const enrichedPosts: Post[] = serverPosts.map((p) => ({
    ...p,
    likeCount: likeUpdates.has(p.id) ? (likeUpdates.get(p.id) ?? p.likeCount) : p.likeCount,
    onChainTxHash: anchorUpdates.has(p.id) ? (anchorUpdates.get(p.id) ?? p.onChainTxHash) : p.onChainTxHash,
  }));

  const sortedPosts = sortMode === "top"
    ? [...enrichedPosts].sort((a, b) => (b.likeCount ?? 0) - (a.likeCount ?? 0) || Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id - a.id)
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
    if ((!imageFile && !publication.draft) || !user || postingLock.current) return;
    postingLock.current = true;
    setUploadError(null);
    try {
      if (publication.draft) {
        setPostStep("signing");
        await publication.publish(undefined, recoveryHash);
      } else {
        setPostStep("uploading");
        const { uploadURL, objectPath } = await requestUploadUrl(imageFile!);
        await uploadToGCS(uploadURL, imageFile!);
        const imageUrl = `${BASE}/api/storage${objectPath}`;
        setPostStep("signing");
        await publication.publish({ content: content.trim(), imageUrl, isPaid: isExclusive });
      }
      if (!(publication.draft?.isPaid ?? isExclusive)) trackProductEvent("public_post_created");

      setPostStep("done");
      setIsComposeOpen(false);
      setContent("");
      setRecoveryHash("");
      clearImage();
      queryClient.invalidateQueries({ queryKey: getListPostsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetFeedSummaryQueryKey() });
      setTimeout(() => setPostStep("idle"), 3000);
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Failed to post. Please try again.");
      setPostStep("error");
    } finally { postingLock.current = false; }
  };

  const handleOpenChange = (open: boolean) => {
    setIsComposeOpen(open);
    if (!open && !postingLock.current && !publication.busy) { clearImage(); setContent(""); setUploadError(null); setRecoveryHash(""); setPostStep("idle"); setIsExclusive(false); }
  };

  const isPosting = publication.busy || postStep === "uploading" || postStep === "saving" || postStep === "signing";
  const displayedExclusive = publication.draft?.isPaid ?? isExclusive;

  const postButtonLabel = () => {
    if (postStep === "uploading") return "Uploading image...";
    if (postStep === "saving") return "Saving post...";
    if (postStep === "signing" || publication.busy) return "Checking publication...";
    return publication.draft ? "Resume publication" : "Publish on Monad";
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

      {publication.draft && <Card><CardContent className="p-4 space-y-2">
        <p className="text-sm">You have a pending publication. Resume it using its original transaction.</p>
        <Button size="sm" onClick={() => setIsComposeOpen(true)}>Resume pending post</Button>
      </CardContent></Card>}

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
      <p className="text-xs text-muted-foreground">
        {sortMode === "top" ? "Top ranks the loaded posts by verified recorded likes, with newer posts first when counts tie." : "Latest sorts by the app creation date, newest first."}
      </p>
      {pendingCount > 0 && (
        <button
          onClick={handleFlushPending}
          className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-primary text-primary-foreground font-semibold text-sm shadow-lg hover:bg-primary/90 transition-all animate-in slide-in-from-top-2 duration-300"
        >
          <ArrowUp className="h-4 w-4" />
          {pendingCount} new {pendingCount === 1 ? "post" : "posts"}, tap to load
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
        {createPortal(<div className="fixed z-40 right-4 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] md:bottom-8 md:right-8">
          <DialogTrigger asChild>
          <Button
            size="icon"
             className="h-14 w-14 rounded-full shadow-lg shadow-primary/30 hover:scale-105 active:scale-95 transition-transform"
             aria-label="Create a post"
             title="Create a post"
          >
            <Plus className="h-6 w-6" />
          </Button>
          </DialogTrigger>
        </div>, document.body)}
        <DialogContent className="w-[calc(100%-2rem)] min-w-0 sm:max-w-lg max-h-[90dvh] overflow-y-auto [overflow-wrap:anywhere]">
          <DialogHeader>
            <DialogTitle>Create a Post</DialogTitle>
          </DialogHeader>
          <div className="min-w-0 space-y-4 pt-2">
            <PublicationRecovery draft={publication.draft} busy={isPosting} onDiscard={publication.discard}
              onError={setUploadError} transactionHash={recoveryHash} onTransactionHashChange={setRecoveryHash} />
            <div>
              {(publication.draft?.imageUrl || imagePreview) ? (
                <div className="relative rounded-xl overflow-hidden bg-muted aspect-video">
                  <img src={publication.draft?.imageUrl || imagePreview!} alt="Preview" className="w-full h-full object-cover" />
                  {!publication.draft && <button
                    onClick={clearImage}
                    className="absolute top-2 right-2 bg-black/60 text-white rounded-full p-1 hover:bg-black/80 transition-colors"
                  >
                    <X className="h-4 w-4" />
                  </button>}
                </div>
              ) : (
                <button
                  type="button"
                  disabled={isPosting || !!publication.draft}
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full rounded-xl border-2 border-dashed border-border hover:border-primary/50 bg-muted/30 hover:bg-primary/5 transition-colors aspect-video flex flex-col items-center justify-center gap-3 cursor-pointer"
                >
                  <div className="p-3 bg-primary/10 rounded-full">
                    <ImageIcon className="h-7 w-7 text-primary" />
                  </div>
                  <div className="text-center">
                    <p className="font-semibold text-sm">Add an image</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Image required. Select an image file; caption is optional.</p>
                  </div>
                </button>
              )}
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelect} disabled={isPosting || !!publication.draft} />
            </div>

            <Textarea
              placeholder="Add a caption... (optional)"
              value={publication.draft?.content ?? content}
              disabled={isPosting || !!publication.draft}
              onChange={(e) => setContent(e.target.value)}
              className="min-h-[80px] resize-none"
            />

            {/* Exclusive post toggle */}
            <button
              type="button"
              disabled={isPosting || !!publication.draft}
              onClick={() => setIsExclusive((v) => !v)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border-2 transition-all text-sm font-medium ${
                displayedExclusive
                  ? "border-amber-400 bg-amber-50 text-amber-800"
                  : "border-border bg-muted/30 text-muted-foreground hover:border-primary/30 hover:bg-muted/50"
              }`}
            >
              <div className={`p-1.5 rounded-lg ${displayedExclusive ? "bg-amber-200 text-amber-700" : "bg-muted text-muted-foreground"}`}>
                {displayedExclusive ? <Lock className="h-4 w-4" /> : <Crown className="h-4 w-4" />}
              </div>
              <div className="flex-1 text-left">
                <p className="font-semibold leading-tight">{displayedExclusive ? "Exclusive post" : "Make exclusive"}</p>
                <p className="text-xs font-normal mt-0.5 opacity-75">
                  {displayedExclusive
                    ? "Only verified subscribers can see this post; others see a locked preview"
                    : "All followers see this, toggle to restrict to subscribers only"}
                </p>
              </div>
              <div className={`h-5 w-9 rounded-full transition-all flex-shrink-0 ${displayedExclusive ? "bg-amber-500" : "bg-muted-foreground/30"}`}>
                <div className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${displayedExclusive ? "translate-x-4" : "translate-x-0"}`} />
              </div>
            </button>

            {contractDeployed && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 rounded-lg px-3 py-2">
                <Link2 className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                Approving the wallet transaction records your authorship, post ID and content commitment on Monad Mainnet. Network gas is required. Images and captions are stored by the app, not fully on-chain. Rejection or failure leaves the draft unpublished. A published post cannot be deleted by anyone.
              </div>
            )}

            {postStep === "signing" && (
              <div className="flex items-center gap-2 text-xs text-violet-700 bg-violet-50 rounded-lg px-3 py-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin flex-shrink-0" />
                Checking your publication on Monad. If already confirmed, no new signature is needed. You can close this window safely; your draft is kept.
              </div>
            )}

            {uploadError && <p role="alert" data-testid="status-post-error" className="min-w-0 break-words text-sm text-destructive">{uploadError}</p>}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => handleOpenChange(false)}>{isPosting ? "Close" : "Cancel"}</Button>
              <Button onClick={handleCreatePost} disabled={(!imageFile && !publication.draft) || isPosting || !contractDeployed}>
                {isPosting
                  ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />{postButtonLabel()}</>
                  : postButtonLabel()}
              </Button>
            </div>
            {!imageFile && !publication.draft && <p className="text-xs text-muted-foreground">Publishing is unavailable until you select the required image.</p>}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
