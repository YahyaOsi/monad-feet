import { useState, useEffect } from "react";
import { useUser } from "@/context/UserContext";
import { useUpdateMe, useUpdateSubscriptionPrice } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

export default function Settings() {
  const { user } = useUser();
  const { toast } = useToast();
  
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [subPrice, setSubPrice] = useState("");

  const updateMe = useUpdateMe();
  const updatePrice = useUpdateSubscriptionPrice();

  useEffect(() => {
    if (user) {
      setName(user.name || "");
      setBio(user.bio || "");
      setAvatarUrl(user.avatarUrl || "");
      setSubPrice(user.subscriptionPrice?.toString() || "");
    }
  }, [user]);

  const handleUpdateProfile = async () => {
    if (!user) return;
    try {
      await updateMe.mutateAsync({
        data: {
          walletAddress: user.walletAddress,
          name,
          bio,
          avatarUrl
        }
      });
      toast({ title: "Profile updated successfully" });
    } catch (e) {
      toast({ title: "Error updating profile", variant: "destructive" });
    }
  };

  const handleUpdatePrice = async () => {
    if (!user) return;
    try {
      await updatePrice.mutateAsync({
        data: {
          walletAddress: user.walletAddress,
          pricePerMonth: Number(subPrice) || 0
        }
      });
      toast({ title: "Subscription price updated" });
    } catch (e) {
      toast({ title: "Error updating price", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">Manage your account and creator settings</p>
      </div>

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
            <Input value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} />
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

      <Card>
        <CardHeader>
          <CardTitle>Creator Settings</CardTitle>
          <CardDescription>Set a monthly price in MON for users to access your private feed.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Monthly Subscription Price (MON)</Label>
            <Input type="number" step="0.1" value={subPrice} onChange={(e) => setSubPrice(e.target.value)} placeholder="0.0" />
            <p className="text-xs text-muted-foreground">Set to 0 to disable private subscriptions.</p>
          </div>
          <Button onClick={handleUpdatePrice} disabled={updatePrice.isPending}>
             {updatePrice.isPending ? "Saving..." : "Save Price"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
