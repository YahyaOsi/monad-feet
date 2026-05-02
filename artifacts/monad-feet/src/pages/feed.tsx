import { useState, useRef } from "react";
import { useUser } from "@/context/UserContext";
import { useListPosts, useGetFeedSummary, useCreatePost } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { PostCard } from "@/components/post/PostCard";
import { Plus, Users, Heart, MessageSquare, ImageIcon, X, Loader2, Link2, CheckCircle2, Flame, TrendingUp } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { getListPostsQueryKey, getGetFeedSummaryQueryKey } from "@workspace/api-client-react";
import { useContractActions } from "@/lib/useContractActions";

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
  const res = await fetch(uploadURL, {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file,
  });
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
  const [sortMode, setSortMode] = useState<SortMode>("latest");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setUploadError("Please select an image file.");
      return;
    }
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
        data: { content: content.trim() || "", imageUrl, authorWalletAddress: user.walletAddress },
      });

      if (contractDeployed && post?.id) {
        setPostStep("signing");
        try {
          const contentUri = `mf:${post.id}:${objectPath}`;
          const txHash = await createPostOnChain(post.id, contentUri);
          if (txHash) await anchorPostOnDB(post.id, txHash);
        } catch {
          // user declined or error — post is already saved
        }
      }

      setPostStep("done");
      setIsComposeOpen(false);
      setContent("");
      clearImage();
      queryClient.invalidateQueries({ queryKey: getListPostsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetFeedSummaryQueryKey() });

      setTimeout(() => setPostStep("idle"), 3000);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to post. Please try again.";
      setUploadError(msg);
      setPostStep("error");
    }
  };

  const handleOpenChange = (open: boolean) => {
    setIsComposeOpen(open);
    if (!open) {
      clearImage();
      setContent("");
      setUploadError(null);
      setPostStep("idle");
    }
  };

  const isPosting = postStep === "uploading" || postStep === "saving" || postStep === "signing";

  const postButtonLabel = () => {
    if (postStep === "uploading") return "Uploading image...";
    if (postStep === "saving") return "Saving post...";
    if (postStep === "signing") return "Sign on Monad...";
    return contractDeployed ? "Post & Sign on Monad" : "Post";
  };

  const allPosts = feedPage?.posts ?? [];
  const sortedPosts = sortMode === "top"
    ? [...allPosts].sort((a, b) => (b.likeCount ?? 0) - (a.likeCount ?? 0))
    : allPosts;

  return (
    <div className="space-y-6 pb-20">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Feed</h1>
        <div className="flex items-center gap-2">
          {postStep === "done" && (
            <div className="flex items-center gap-1.5 text-xs text-green-600 font-medium">
              <CheckCircle2 className="h-3.5 w-3.5" /> Posted{contractDeployed ? " & anchored on Monad" : ""}
            </div>
          )}
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
                <p className="text-2xl font-bold">{summary.totalPosts}</p>
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
      </div>

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
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Required — click to browse or drop a file
                    </p>
                  </div>
                </button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileSelect}
              />
            </div>

            <Textarea
              placeholder="Add a caption... (optional)"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="min-h-[80px] resize-none"
            />

            {contractDeployed && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 rounded-lg px-3 py-2">
                <Link2 className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                <span>
                  This post will be anchored on{" "}
                  <strong>Monad Mainnet</strong> — your wallet will prompt for a signature.
                </span>
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
              <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={isPosting}>
                Cancel
              </Button>
              <Button onClick={handleCreatePost} disabled={!imageFile || isPosting}>
                {isPosting ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> {postButtonLabel()}</>
                ) : postButtonLabel()}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
