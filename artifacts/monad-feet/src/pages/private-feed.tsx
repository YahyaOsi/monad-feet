import { useState, useRef } from "react";
import { Link } from "wouter";
import { useUser } from "@/context/UserContext";
import { useListSubscriptions, useListPrivatePosts } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  Lock, Crown, ExternalLink, Link2, CheckCircle2, Calendar, Loader2, Plus, ImageIcon, X
} from "lucide-react";
import { formatDistanceToNow, format, isPast } from "date-fns";
import { useAccount } from "wagmi";
import { useIsSubscribedOnChain, useSubscriptionExpiry } from "@/lib/useOnChain";
import { CONTRACT_DEPLOYED } from "@/lib/contract";
import { useQueryClient } from "@tanstack/react-query";
import { getListPrivatePostsQueryKey } from "@workspace/api-client-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

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
  const expiryDate = chainExpiry ? new Date(Number(chainExpiry) * 1000) : new Date(dbExpiry);
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
        href={`https://monvision.io/tx/${txHash}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 border border-violet-200 hover:bg-violet-200 transition-colors"
      >
        <Link2 className="h-2.5 w-2.5" /> Tx <ExternalLink className="h-2 w-2" />
      </a>
    );
  }
  return null;
}

type CreateStep = "idle" | "uploading" | "saving" | "error";

function PrivatePostImage({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <p role="status" className="rounded-xl bg-muted p-6 text-sm text-muted-foreground text-center">
      Image unavailable. Check your subscription and refresh the page.
    </p>
  ) : (
    <div className="rounded-xl overflow-hidden bg-muted">
      <img src={src} alt="Private post" className="w-full max-h-96 object-cover" onError={() => setFailed(true)} />
    </div>
  );
}

function CreatePrivatePostDialog({ creatorId, onCreated }: { creatorId: number; onCreated: () => void }) {
  const { user } = useUser();
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [step, setStep] = useState<CreateStep>("idle");
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { setError("Please select an image file."); return; }
    setError(null);
    setImageFile(file);
    const reader = new FileReader();
    reader.onload = () => setImagePreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const clearImage = () => {
    setImageFile(null);
    setImagePreview(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleCreate = async () => {
    if (!imageFile || !user) return;
    setError(null);
    try {
      setStep("uploading");
      const wallet = localStorage.getItem("mf_wallet_address") ?? "";
      const urlRes = await fetch(`${BASE}/api/storage/uploads/request-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-wallet-address": wallet },
        body: JSON.stringify({ name: imageFile.name, size: imageFile.size, contentType: imageFile.type }),
      });
       if (!urlRes.ok) {
         const body = await urlRes.json().catch(() => null);
         throw new Error(body?.error ?? "Failed to get upload URL");
       }
      const { uploadURL, objectPath } = await urlRes.json() as { uploadURL: string; objectPath: string };

       const uploadRes = await fetch(uploadURL, {
        method: "PUT",
        headers: { "Content-Type": imageFile.type },
        body: imageFile,
      });
       if (!uploadRes.ok) throw new Error("Image upload failed. Please try again.");
      const imageUrl = `${BASE}/api/storage${objectPath}`;

      setStep("saving");
      const postRes = await fetch(`${BASE}/api/private-posts`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-wallet-address": wallet },
        body: JSON.stringify({ content: content.trim() || "", imageUrl, creatorWalletAddress: user.walletAddress }),
      });
       if (!postRes.ok) {
         const body = await postRes.json().catch(() => null);
         throw new Error(body?.error ?? "Failed to create post");
       }

      queryClient.invalidateQueries({ queryKey: getListPrivatePostsQueryKey({ creatorId }) });
      onCreated();
      setOpen(false);
      setContent("");
      clearImage();
      setStep("idle");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to post");
      setStep("error");
    }
  };

  const isPosting = step === "uploading" || step === "saving";

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { clearImage(); setContent(""); setError(null); setStep("idle"); }}}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-2">
          <Plus className="h-4 w-4" /> New Private Post
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="h-4 w-4" /> Create Exclusive Post
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          {imagePreview ? (
            <div className="relative rounded-xl overflow-hidden bg-muted aspect-video">
              <img src={imagePreview} alt="Preview" className="w-full h-full object-cover" />
              <button onClick={clearImage} className="absolute top-2 right-2 bg-black/60 text-white rounded-full p-1 hover:bg-black/80">
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="w-full rounded-xl border-2 border-dashed border-border hover:border-primary/50 bg-muted/30 hover:bg-primary/5 transition-colors aspect-video flex flex-col items-center justify-center gap-3 cursor-pointer"
            >
              <div className="p-3 bg-primary/10 rounded-full">
                <ImageIcon className="h-7 w-7 text-primary" />
              </div>
              <div className="text-center">
                <p className="font-semibold text-sm">Add an image</p>
                <p className="text-xs text-muted-foreground mt-0.5">Required for private posts</p>
              </div>
            </button>
          )}
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelect} />

          <Textarea
            placeholder="Write your exclusive content… (optional)"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="min-h-[80px] resize-none"
          />

          <div className="flex items-center gap-2 text-xs text-muted-foreground bg-primary/5 rounded-lg px-3 py-2">
            <Lock className="h-3.5 w-3.5 text-primary flex-shrink-0" />
            Only your subscribers will see this post
          </div>

           {error && <p role="alert" data-testid="status-private-post-error" className="text-sm text-destructive">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={isPosting}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!imageFile || isPosting} className="gap-2">
              {isPosting && <Loader2 className="h-4 w-4 animate-spin" />}
              {step === "uploading" ? "Uploading…" : step === "saving" ? "Saving…" : "Post Exclusively"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PrivatePosts({ creatorId, isCreator }: { creatorId: number; isCreator: boolean }) {
  const [refresh, setRefresh] = useState(0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: posts, isLoading } = useListPrivatePosts({ creatorId }, {
    query: { enabled: creatorId > 0, queryKey: [getListPrivatePostsQueryKey({ creatorId }), refresh] as any }
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[...Array(2)].map((_, i) => <Card key={i} className="animate-pulse h-32" />)}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {isCreator && (
        <div className="flex justify-end">
          <CreatePrivatePostDialog creatorId={creatorId} onCreated={() => setRefresh(r => r + 1)} />
        </div>
      )}

      {!posts || posts.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Lock className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm">No private posts yet from this creator.</p>
            {isCreator && (
              <p className="text-xs mt-2 text-primary">Use the button above to create your first exclusive post.</p>
            )}
          </CardContent>
        </Card>
      ) : (
        posts.map((post) => (
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
                <PrivatePostImage key={post.imageUrl} src={post.imageUrl} />
              )}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}

export default function PrivateFeed() {
  const { user } = useUser();
  const { address } = useAccount();
  const [selectedCreatorId, setSelectedCreatorId] = useState<number | null>(null);

  const { data: subscriptions, isLoading: subsLoading } = useListSubscriptions();

  const activeSubs = subscriptions ?? [];
  const activeCreatorId = selectedCreatorId ?? activeSubs[0]?.creatorId ?? 0;
  const selectedSub = activeSubs.find((s) => s.creatorId === activeCreatorId) ?? activeSubs[0];

  // Creator can see their own private posts (for posting)
  const isCreatorOfSelected = user?.id === activeCreatorId;

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
                      href={`https://monvision.io/tx/${sub.txHash}`}
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

          {/* Posts panel */}
          <div>
            {activeCreatorId > 0 ? (
              <PrivatePosts creatorId={activeCreatorId} isCreator={isCreatorOfSelected} />
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
