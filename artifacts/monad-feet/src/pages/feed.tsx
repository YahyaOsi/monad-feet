import { useState, useRef } from "react";
import { useUser } from "@/context/UserContext";
import { useListPosts, useGetFeedSummary, useCreatePost } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { PostCard } from "@/components/post/PostCard";
import { Plus, Users, Heart, MessageSquare, ImageIcon, X, Loader2, Link2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { getListPostsQueryKey, getGetFeedSummaryQueryKey } from "@workspace/api-client-react";
import { useWriteContract } from "wagmi";
import { MONAD_FEET_CONTRACT_ADDRESS, MONAD_FEET_ABI, CONTRACT_DEPLOYED } from "@/lib/contract";

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

export default function Feed() {
  const { user } = useUser();
  const queryClient = useQueryClient();
  const { data: feedPage, isLoading: feedLoading } = useListPosts({});
  const { data: summary } = useGetFeedSummary();
  const createPost = useCreatePost();
  const { writeContractAsync } = useWriteContract();

  const [isComposeOpen, setIsComposeOpen] = useState(false);
  const [content, setContent] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [anchoringStatus, setAnchoringStatus] = useState<"idle" | "anchoring" | "anchored" | "failed">("idle");
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
    setUploading(true);
    setUploadError(null);
    setAnchoringStatus("idle");
    try {
      // 1. Upload image to GCS
      const { uploadURL, objectPath } = await requestUploadUrl(imageFile);
      await uploadToGCS(uploadURL, imageFile);
      const imageUrl = `${BASE}/api/storage${objectPath}`;

      // 2. Create post in DB
      const post = await createPost.mutateAsync({
        data: { content: content.trim() || "", imageUrl, authorWalletAddress: user.walletAddress },
      });

      setIsComposeOpen(false);
      setContent("");
      clearImage();
      queryClient.invalidateQueries({ queryKey: getListPostsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetFeedSummaryQueryKey() });

      // 3. Anchor post on Monad mainnet (non-blocking — fires after dialog closes)
      if (CONTRACT_DEPLOYED && post?.id) {
        setAnchoringStatus("anchoring");
        try {
          const postIdentifier = `mf:${post.id}:${objectPath}`;
          const txHash = await writeContractAsync({
            address: MONAD_FEET_CONTRACT_ADDRESS,
            abi: MONAD_FEET_ABI,
            functionName: "createPost",
            args: [postIdentifier],
          });
          await anchorPostOnDB(post.id, txHash);
          queryClient.invalidateQueries({ queryKey: getListPostsQueryKey() });
          setAnchoringStatus("anchored");
        } catch {
          setAnchoringStatus("failed");
        }
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to post. Please try again.";
      setUploadError(msg);
    } finally {
      setUploading(false);
    }
  };

  const handleOpenChange = (open: boolean) => {
    setIsComposeOpen(open);
    if (!open) { clearImage(); setContent(""); setUploadError(null); }
  };

  return (
    <div className="space-y-6 pb-20">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Feed</h1>
        {anchoringStatus === "anchoring" && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground animate-pulse">
            <Loader2 className="h-3 w-3 animate-spin" /> Anchoring on Monad...
          </div>
        )}
        {anchoringStatus === "anchored" && (
          <div className="flex items-center gap-1.5 text-xs text-green-600 font-medium">
            <Link2 className="h-3 w-3" /> Anchored on Monad
          </div>
        )}
      </div>

      {summary && (
        <div className="grid grid-cols-3 gap-4">
          <Card className="bg-primary/5 border-none shadow-none">
            <CardContent className="p-4 flex items-center gap-4">
              <div className="p-3 bg-primary/10 rounded-full text-primary"><MessageSquare className="h-5 w-5" /></div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Posts</p>
                <p className="text-2xl font-bold">{summary.totalPosts}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-primary/5 border-none shadow-none">
            <CardContent className="p-4 flex items-center gap-4">
              <div className="p-3 bg-primary/10 rounded-full text-primary"><Heart className="h-5 w-5" /></div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Likes</p>
                <p className="text-2xl font-bold">{summary.totalLikes}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-primary/5 border-none shadow-none">
            <CardContent className="p-4 flex items-center gap-4">
              <div className="p-3 bg-primary/10 rounded-full text-primary"><Users className="h-5 w-5" /></div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Active Today</p>
                <p className="text-2xl font-bold">{summary.activeToday}</p>
              </div>
            </CardContent>
          </Card>
        </div>
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
        ) : feedPage?.posts.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <ImageIcon className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No posts yet.</p>
            <p className="text-sm mt-1">Be the first to share a moment!</p>
          </div>
        ) : (
          feedPage?.posts.map((post) => <PostCard key={post.id} post={post} />)
        )}
      </div>

      <Dialog open={isComposeOpen} onOpenChange={handleOpenChange}>
        <DialogTrigger asChild>
          <Button size="icon" className="fixed bottom-20 md:bottom-8 right-4 md:right-8 h-14 w-14 rounded-full shadow-lg hover:shadow-xl transition-all">
            <Plus className="h-6 w-6" />
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create a Post</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            {/* Image upload area — required */}
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
                    <p className="text-xs text-muted-foreground mt-0.5">Required — click to browse or drop a file</p>
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

            {/* Optional caption */}
            <Textarea
              placeholder="Add a caption... (optional)"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="min-h-[80px] resize-none"
            />

            {CONTRACT_DEPLOYED && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 rounded-lg px-3 py-2">
                <Link2 className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                <span>This post will be anchored on <strong>Monad mainnet</strong> for permanent proof of authorship.</span>
              </div>
            )}

            {uploadError && (
              <p className="text-sm text-destructive">{uploadError}</p>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={uploading}>
                Cancel
              </Button>
              <Button onClick={handleCreatePost} disabled={!imageFile || uploading}>
                {uploading ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Posting...</>
                ) : "Post"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
