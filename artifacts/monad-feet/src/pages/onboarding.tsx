import { useState } from "react";
import { useLocation, Redirect } from "wouter";
import { useValidateInviteCode, useRegisterUser } from "@workspace/api-client-react";
import { useUser } from "@/context/UserContext";
import { useAccount } from "wagmi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

export default function Onboarding() {
  const [step, setStep] = useState<1 | 2>(1);
  const [inviteCode, setInviteCode] = useState("");
  const [inviteError, setInviteError] = useState("");
  
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [bio, setBio] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");

  const { isConnected, address } = useAccount();
  const { user, isLoading } = useUser();
  const [, setLocation] = useLocation();

  const validateInvite = useValidateInviteCode();
  const register = useRegisterUser();

  if (isLoading) return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  if (!isConnected) return <Redirect to="/" />;
  if (user) return <Redirect to="/feed" />;

  const handleValidate = async () => {
    if (!inviteCode.trim()) return;
    try {
      const res = await validateInvite.mutateAsync({ data: { code: inviteCode } });
      if (res.valid) {
        setStep(2);
        setInviteError("");
      } else {
        setInviteError(res.message);
      }
    } catch (e: any) {
      setInviteError(e.response?.data?.error || "Invalid invite code");
    }
  };

  const handleRegister = async () => {
    if (!name || !username || !address) return;
    try {
      await register.mutateAsync({
        data: {
          walletAddress: address,
          inviteCode,
          name,
          username,
          bio,
          avatarUrl: avatarUrl || undefined,
        }
      });
      // Force reload to get user state
      window.location.href = "/feed";
    } catch (e: any) {
      console.error(e);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md shadow-xl border-border/50">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold">Welcome to Monad Feet</CardTitle>
          <CardDescription>
            {step === 1 ? "Enter your invite code to continue." : "Set up your profile to join."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {step === 1 ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="invite">Invite Code</Label>
                <Input
                  id="invite"
                  placeholder="e.g. MNF-XYZ"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  className="text-center text-lg tracking-widest uppercase"
                />
                {inviteError && <p className="text-sm text-destructive">{inviteError}</p>}
              </div>
              <Button 
                className="w-full" 
                onClick={handleValidate} 
                disabled={!inviteCode.trim() || validateInvite.isPending}
              >
                {validateInvite.isPending ? "Verifying..." : "Verify Code"}
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Display Name</Label>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Satoshi Nakamoto" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-muted-foreground">@</span>
                  <Input id="username" className="pl-8" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="satoshi" />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="avatar">Avatar URL (optional)</Label>
                <Input id="avatar" value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} placeholder="https://..." />
              </div>
              <div className="space-y-2">
                <Label htmlFor="bio">Bio (optional)</Label>
                <Textarea id="bio" value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Building the future of finance..." className="resize-none" />
              </div>
              <Button 
                className="w-full" 
                onClick={handleRegister}
                disabled={!name.trim() || !username.trim() || register.isPending}
              >
                {register.isPending ? "Joining..." : "Join Monad Feet"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
