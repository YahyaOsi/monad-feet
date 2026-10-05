import { useState, useEffect, useRef } from "react";
import { useUpload } from "@workspace/object-storage-web";
import { useUser } from "@/context/UserContext";
import { AnalyticsPrivacySettings } from "@/components/AnalyticsPreferences";
import { useUpdateMe, useUpdateSubscriptionPrice } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAccount } from "wagmi";
import { useOnChainUser } from "@/lib/useOnChain";
import { CONTRACT_DEPLOYED } from "@/lib/contract";
import { Camera, CheckCircle2, AlertCircle, ExternalLink, Link2, Copy, ShieldX, ShieldCheck, Loader2 } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export default function Settings() {
  const { user } = useUser();
  const { address } = useAccount();
  const { toast } = useToast();

  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [subPrice, setSubPrice] = useState("");
  const [copiedAddress, setCopiedAddress] = useState(false);

  type BlockedUser = { id: number; name: string | null; username: string | null; avatarUrl: string | null };
  const [blockedUsers, setBlockedUsers] = useState<BlockedUser[]>([]);
  const [unblockingId, setUnblockingId] = useState<number | null>(null);

  const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
  const wallet = () => localStorage.getItem("mf_wallet_address") ?? "";

  useEffect(() => {
    if (!user) return;
    fetch(`${BASE}/api/users/blocked`, { headers: { "x-wallet-address": wallet() } })
      .then((r) => r.ok ? r.json() : [])
      .then((data: BlockedUser[]) => setBlockedUsers(data))
      .catch(() => {});
  }, [user]);

  const handleUnblock = async (targetId: number) => {
    setUnblockingId(targetId);
    try {
      await fetch(`${BASE}/api/users/block/${targetId}`, {
        method: "DELETE",
        headers: { "x-wallet-address": wallet(), "Content-Type": "application/json" },
      });
      setBlockedUsers((prev) => prev.filter((u) => u.id !== targetId));
      toast({ title: "User unblocked" });
    } catch {
      toast({ title: "Failed to unblock", variant: "destructive" });
    } finally {
      setUnblockingId(null);
    }
  };

  const updateMe = useUpdateMe();
  const fileRef = useRef<HTMLInputElement>(null);
  const { uploadFile, isUploading, progress } = useUpload({ basePath: `${BASE}/api/storage` });

  const handleAvatarFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !user) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Please choose an image file", variant: "destructive" });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "Image is too large", description: "Max size is 5 MB.", variant: "destructive" });
      return;
    }
    const res = await uploadFile(file);
    if (!res) {
      toast({ title: "Upload failed", description: "Please try again.", variant: "destructive" });
      return;
    }
    const url = `${BASE}/api/storage${res.objectPath}`;
    setAvatarUrl(url);
    try {
      await updateMe.mutateAsync({ data: { walletAddress: user.walletAddress, name, bio, avatarUrl: url } });
      toast({ title: "Profile picture updated" });
    } catch {
      toast({ title: "Could not save picture", variant: "destructive" });
    }
  };
  const updatePrice = useUpdateSubscriptionPrice();
  const { data: onChainUser, isLoading: chainLoading } = useOnChainUser(address);

  useEffect(() => {
    if (user) {
      setName(user.name ?? "");
      setBio(user.bio ?? "");
      setAvatarUrl(user.avatarUrl ?? "");
      setSubPrice(user.subscriptionPrice?.toString() ?? "");
    }
  }, [user]);

  const handleUpdateProfile = async () => {
    if (!user) return;
    try {
      await updateMe.mutateAsync({
        data: { walletAddress: user.walletAddress, name, bio, avatarUrl },
      });
      toast({ title: "Profile updated" });
    } catch {
      toast({ title: "Error updating profile", variant: "destructive" });
    }
  };

  const handleUpdatePrice = async () => {
    if (!user) return;
    try {
      await updatePrice.mutateAsync({
        data: { walletAddress: user.walletAddress, pricePerMonth: Number(subPrice) || 0 },
      });
      toast({ title: "Subscription price updated" });
    } catch {
      toast({ title: "Error updating price", variant: "destructive" });
    }
  };

  const copyAddress = () => {
    if (!address) return;
    navigator.clipboard.writeText(address);
    setCopiedAddress(true);
    setTimeout(() => setCopiedAddress(false), 2000);
  };

  const onChainRegistered = onChainUser?.[0] === true;
  const onChainUsername = onChainUser?.[1] as string | undefined;
  const onChainStreak = onChainUser?.[6] ? Number(onChainUser[6]) : 0;
  const onChainPoints = onChainUser?.[5] ? Number(onChainUser[5]) : 0;

  return (
    <div className="space-y-6 max-w-2xl mx-auto pb-24 md:pb-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">Your profile, wallet and creator price.</p>
      </div>

      <AnalyticsPrivacySettings />

      {/* On-chain Status */}
      <Card className={`border ${onChainRegistered ? "border-green-200 bg-green-50/30" : "border-muted"}`}>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Link2 className="h-4 w-4 text-violet-600" /> On-Chain Status
          </CardTitle>
          <CardDescription>Your status on Monad</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Contract status */}
          {!CONTRACT_DEPLOYED ? (
            <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              On-chain features are not live yet.
            </div>
          ) : chainLoading ? (
            <div className="text-sm text-muted-foreground">Checking chain status...</div>
          ) : onChainRegistered ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 rounded-lg px-3 py-2">
                <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                Registered on Monad as <strong>@{onChainUsername}</strong>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-muted rounded-lg p-3 text-center">
                  <p className="text-xs text-muted-foreground">On-chain Streak</p>
                  <p className="text-xl font-bold text-orange-500">{onChainStreak}d</p>
                </div>
                <div className="bg-muted rounded-lg p-3 text-center">
                  <p className="text-xs text-muted-foreground">On-chain Points</p>
                  <p className="text-xl font-bold text-primary">{onChainPoints}</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted rounded-lg px-3 py-2">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              Not yet registered on-chain. Re-register or contact support.
            </div>
          )}

          {/* Registration tx hash */}
          {user?.registrationTxHash && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground font-medium w-24 flex-shrink-0">Reg. Tx</span>
              <a
                href={`https://monvision.io/tx/${user.registrationTxHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-violet-600 hover:text-violet-800 font-mono transition-colors"
              >
                {user.registrationTxHash.slice(0, 12)}…{user.registrationTxHash.slice(-6)}
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Wallet Info */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Wallet</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="flex-1 flex items-center gap-2 bg-muted rounded-lg px-3 py-2">
              <code className="text-xs font-mono flex-1 truncate">{address ?? "Not connected"}</code>
              <button onClick={copyAddress} className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0">
                {copiedAddress ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
            </div>
            {address && (
              <a
                href={`https://monvision.io/address/${address}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-shrink-0 text-muted-foreground hover:text-violet-600 transition-colors"
              >
                <ExternalLink className="h-4 w-4" />
              </a>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            This wallet address is your permanent identity on Monad Feet.
          </p>
        </CardContent>
      </Card>

      {/* Profile */}
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={isUploading}
              className="group relative h-24 w-24 shrink-0 rounded-full overflow-hidden ring-2 ring-border hover:ring-primary transition-colors self-center sm:self-auto"
              aria-label="Upload a new profile picture"
              data-testid="button-upload-avatar"
            >
              <Avatar className="h-24 w-24">
                <AvatarImage src={avatarUrl} alt="Profile picture" className="object-cover" />
                <AvatarFallback className="text-xl font-semibold bg-primary/15 text-primary">
                  {name.slice(0, 2).toUpperCase() || "MF"}
                </AvatarFallback>
              </Avatar>
              <span className="absolute inset-0 flex items-center justify-center bg-foreground/50 text-background opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity">
                {isUploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}
              </span>
            </button>
            <div className="space-y-1.5 text-center sm:text-left">
              <Label>Profile picture</Label>
              <p className="text-xs text-muted-foreground">JPG, PNG, WEBP or GIF. Up to 5 MB.</p>
              <Button type="button" size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={isUploading} className="gap-1.5">
                {isUploading ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Uploading {progress}%</> : <><Camera className="h-3.5 w-3.5" /> Choose image</>}
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="sr-only"
                onChange={handleAvatarFile}
                data-testid="input-avatar-file"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Bio</Label>
            <Textarea value={bio} onChange={(e) => setBio(e.target.value)} className="resize-none" />
          </div>
          <Button onClick={handleUpdateProfile} disabled={updateMe.isPending}>
            {updateMe.isPending ? "Saving..." : "Save Profile"}
          </Button>
        </CardContent>
      </Card>

      {/* Creator */}
      <Card>
        <CardHeader>
          <CardTitle>Creator</CardTitle>
          <CardDescription>
            Earn $MON through subscriptions. Set a monthly price and you keep 88%.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Monthly Subscription Price (MON)</Label>
            <Input
              type="number"
              step="0.1"
              min="0"
              value={subPrice}
              onChange={(e) => setSubPrice(e.target.value)}
              placeholder="0.0"
            />
            <p className="text-xs text-muted-foreground">
              Set to 0 to turn subscriptions off.
            </p>
          </div>
          {subPrice && Number(subPrice) > 0 && (
            <div className="text-xs text-muted-foreground bg-muted rounded-lg p-3 space-y-1">
              <p>You receive: <strong>{(Number(subPrice) * 0.88).toFixed(4)} MON/mo</strong></p>
              <p>Platform fee: {(Number(subPrice) * 0.12).toFixed(4)} MON/mo (12%)</p>
            </div>
          )}
          <Button onClick={handleUpdatePrice} disabled={updatePrice.isPending}>
            {updatePrice.isPending ? "Saving..." : "Save Price"}
          </Button>
        </CardContent>
      </Card>
      {/* Blocked Users */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldX className="h-4 w-4 text-destructive" />
            Blocked Users
          </CardTitle>
          <CardDescription>
            Blocked users cannot send you messages. You can unblock them at any time.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {blockedUsers.length === 0 ? (
            <div className="flex items-center gap-3 text-sm text-muted-foreground bg-muted/50 rounded-lg px-4 py-3">
              <ShieldCheck className="h-4 w-4 flex-shrink-0 text-green-500" />
              You haven't blocked anyone.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {blockedUsers.map((u) => (
                <li key={u.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <Avatar className="h-9 w-9 flex-shrink-0">
                    <AvatarImage src={u.avatarUrl ?? ""} />
                    <AvatarFallback className="text-xs font-semibold bg-muted text-muted-foreground">
                      {u.name?.slice(0, 2).toUpperCase() ?? "??"}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{u.name ?? u.username ?? "Unknown"}</p>
                    <p className="text-xs text-muted-foreground truncate">@{u.username ?? "-"}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-shrink-0 gap-1.5 text-xs"
                    onClick={() => void handleUnblock(u.id)}
                    disabled={unblockingId === u.id}
                  >
                    {unblockingId === u.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <ShieldCheck className="h-3 w-3" />
                    )}
                    Unblock
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
