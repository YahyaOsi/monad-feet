import { useState, useEffect } from "react";
import { useUser } from "@/context/UserContext";
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
import { CheckCircle2, AlertCircle, ExternalLink, Link2, Copy } from "lucide-react";

export default function Settings() {
  const { user } = useUser();
  const { address } = useAccount();
  const { toast } = useToast();

  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [subPrice, setSubPrice] = useState("");
  const [copiedAddress, setCopiedAddress] = useState(false);

  const updateMe = useUpdateMe();
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
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">Manage your account and creator settings</p>
      </div>

      {/* On-chain Status */}
      <Card className={`border ${onChainRegistered ? "border-green-200 bg-green-50/30" : "border-muted"}`}>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Link2 className="h-4 w-4 text-violet-600" /> On-Chain Status
          </CardTitle>
          <CardDescription>Your verified status on Monad Mainnet</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Contract status */}
          {!CONTRACT_DEPLOYED ? (
            <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              Contract not yet deployed — actions saving to database only.
            </div>
          ) : chainLoading ? (
            <div className="text-sm text-muted-foreground">Checking chain status...</div>
          ) : onChainRegistered ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 rounded-lg px-3 py-2">
                <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                Registered on Monad Mainnet as <strong>@{onChainUsername}</strong>
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
                href={`https://testnet.monadexplorer.com/tx/${user.registrationTxHash}`}
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
                href={`https://testnet.monadexplorer.com/address/${address}`}
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
          <CardTitle>Profile Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Display Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Avatar URL</Label>
            <Input value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} placeholder="https://..." />
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
          <CardTitle>Creator Settings</CardTitle>
          <CardDescription>
            Set a monthly price in MON. Subscribers pay on-chain — you receive 88% directly to your wallet.
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
              Set to 0 to disable. When set, subscribers pay this amount on-chain via the smart contract.
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
    </div>
  );
}
