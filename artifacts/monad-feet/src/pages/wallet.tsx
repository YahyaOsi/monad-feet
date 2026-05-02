import { useState } from "react";
import { useGetWalletBalance, useGetStreak, useDailyCheckin, useGetMyInvites } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Wallet, Coins, Flame, Copy, CheckCircle2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetStreakQueryKey } from "@workspace/api-client-react";

export default function WalletPage() {
  const queryClient = useQueryClient();
  const { data: balance, isLoading: balanceLoading } = useGetWalletBalance();
  const { data: streak, isLoading: streakLoading } = useGetStreak();
  const { data: invites } = useGetMyInvites();
  const checkin = useDailyCheckin();

  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const handleCheckin = async () => {
    try {
      await checkin.mutateAsync({ data: {} });
      queryClient.invalidateQueries({ queryKey: getGetStreakQueryKey() });
    } catch (e) {
      console.error(e);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCode(text);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">Wallet & Rewards</h1>

      <div className="grid md:grid-cols-2 gap-6">
        <Card className="bg-gradient-to-br from-primary/5 to-accent/20 border-primary/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wallet className="h-5 w-5 text-primary" /> Balances
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-1">MON Balance</p>
              <div className="flex items-end gap-2">
                <span className="text-4xl font-bold">{balanceLoading ? "..." : balance?.monBalance || "0"}</span>
                <span className="text-lg font-semibold text-primary mb-1">MON</span>
              </div>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-1">$MFEET Balance</p>
              <div className="flex items-end gap-2">
                <span className="text-3xl font-bold">{balanceLoading ? "..." : balance?.mfeetBalance || "0"}</span>
                <span className="text-base font-semibold text-accent-foreground mb-1">$MFEET</span>
              </div>
            </div>
            <div className="flex gap-3 pt-4">
              <Button className="flex-1" variant="outline">Deposit</Button>
              <Button className="flex-1" disabled>Withdraw</Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Flame className="h-5 w-5 text-orange-500" /> Daily Streak
            </CardTitle>
            <CardDescription>Check in daily to earn points for future airdrops</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-muted p-4 rounded-xl text-center">
                <p className="text-sm text-muted-foreground font-medium mb-1">Current Streak</p>
                <p className="text-2xl font-bold text-orange-500">{streakLoading ? "-" : streak?.currentStreak} <span className="text-sm font-normal text-muted-foreground">days</span></p>
              </div>
              <div className="bg-muted p-4 rounded-xl text-center">
                <p className="text-sm text-muted-foreground font-medium mb-1">Total Points</p>
                <p className="text-2xl font-bold text-primary">{streakLoading ? "-" : streak?.totalPoints}</p>
              </div>
            </div>
            
            <Button 
              className="w-full h-12 text-lg" 
              onClick={handleCheckin}
              disabled={streak?.checkedInToday || checkin.isPending}
            >
              {streak?.checkedInToday ? "Checked in today!" : checkin.isPending ? "Checking in..." : "Check In Now"}
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Invite Codes</CardTitle>
          <CardDescription>Share these codes to invite friends. Active users earn you extra codes.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {!invites || invites.length === 0 ? (
              <p className="text-muted-foreground text-sm">You don't have any invite codes yet. Keep your streak going to earn them!</p>
            ) : (
              invites.map(invite => (
                <div key={invite.id} className="flex items-center gap-3 p-3 bg-muted rounded-lg">
                  <Input 
                    value={invite.code} 
                    readOnly 
                    className="font-mono text-center tracking-widest bg-background"
                  />
                  <Button 
                    variant={invite.used ? "secondary" : "default"}
                    disabled={invite.used}
                    onClick={() => copyToClipboard(invite.code)}
                    className="w-32"
                  >
                    {invite.used ? "Used" : copiedCode === invite.code ? <CheckCircle2 className="h-4 w-4" /> : <><Copy className="h-4 w-4 mr-2" /> Copy</>}
                  </Button>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
