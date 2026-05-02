import { useState } from "react";
import { useGetStreak, useGetMyInvites } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Wallet, Coins, Flame, Copy, CheckCircle2, ExternalLink, Loader2, Link2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetStreakQueryKey } from "@workspace/api-client-react";
import { useAccount, useBalance } from "wagmi";
import { formatUnits } from "viem";
import { useContractActions } from "@/lib/useContractActions";
import { MONAD_MAINNET_CHAIN_ID } from "@/lib/contract";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function apiCheckin(txHash: string | null): Promise<unknown> {
  const wallet = localStorage.getItem("mf_wallet_address") ?? "";
  const res = await fetch(`${BASE}/api/streak/checkin`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-wallet-address": wallet },
    body: JSON.stringify({ txHash }),
  });
  if (!res.ok) throw new Error("Check-in failed");
  return res.json();
}

export default function WalletPage() {
  const queryClient = useQueryClient();
  const { address } = useAccount();
  const { data: streak, isLoading: streakLoading } = useGetStreak();
  const { data: invites } = useGetMyInvites();
  const { contractDeployed, dailyCheckinOnChain } = useContractActions();

  // Real on-chain MON balance from wagmi
  const { data: monBalance, isLoading: balanceLoading } = useBalance({
    address,
    chainId: MONAD_MAINNET_CHAIN_ID,
  });

  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [checkinState, setCheckinState] = useState<"idle" | "signing" | "syncing" | "done" | "error">("idle");

  const handleCheckin = async () => {
    if (streak?.checkedInToday || checkinState !== "idle") return;

    let txHash: string | null = null;

    if (contractDeployed) {
      setCheckinState("signing");
      try {
        txHash = await dailyCheckinOnChain();
      } catch {
        // user declined — continue with DB-only
      }
    }

    setCheckinState("syncing");
    try {
      await apiCheckin(txHash);
      queryClient.invalidateQueries({ queryKey: getGetStreakQueryKey() });
      setCheckinState("done");
    } catch {
      setCheckinState("error");
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCode(text);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const checkinLabel = () => {
    if (streak?.checkedInToday || checkinState === "done") return "Checked in today!";
    if (checkinState === "signing") return "Sign on Monad...";
    if (checkinState === "syncing") return "Syncing...";
    if (checkinState === "error") return "Try again";
    return contractDeployed ? "Sign & Check In" : "Check In Now";
  };

  const isCheckinPending = checkinState === "signing" || checkinState === "syncing";

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">Wallet & Rewards</h1>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Balances */}
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
                <span className="text-4xl font-bold">
                  {balanceLoading
                    ? "..."
                    : monBalance
                    ? Number(formatUnits(monBalance.value, monBalance.decimals)).toFixed(4)
                    : "0.0000"}
                </span>
                <span className="text-lg font-semibold text-primary mb-1">MON</span>
              </div>
              {address && (
                <a
                  href={`https://explorer.monad.xyz/address/${address}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors mt-1"
                >
                  {address.slice(0, 6)}…{address.slice(-4)}
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-1">$MFEET Balance</p>
              <div className="flex items-end gap-2">
                <span className="text-3xl font-bold">
                  <Coins className="inline h-6 w-6 text-yellow-500 mr-1 mb-1" />
                  {streak?.totalPoints ?? 0}
                </span>
                <span className="text-base font-semibold text-accent-foreground mb-1">pts → $MFEET</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">Streak points convert to $MFEET at TGE</p>
            </div>
            <div className="flex gap-3 pt-2">
              <Button className="flex-1" variant="outline" asChild>
                <a href={`https://explorer.monad.xyz/address/${address}`} target="_blank" rel="noopener noreferrer">
                  View on Explorer
                </a>
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Daily Streak */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Flame className="h-5 w-5 text-orange-500" /> Daily Streak
            </CardTitle>
            <CardDescription>
              {contractDeployed
                ? "Each check-in is recorded on Monad Mainnet"
                : "Check in daily to earn points for future airdrops"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-muted p-3 rounded-xl text-center">
                <p className="text-xs text-muted-foreground font-medium mb-1">Current</p>
                <p className="text-2xl font-bold text-orange-500">
                  {streakLoading ? "-" : streak?.currentStreak ?? 0}
                </p>
                <p className="text-xs text-muted-foreground">days</p>
              </div>
              <div className="bg-muted p-3 rounded-xl text-center">
                <p className="text-xs text-muted-foreground font-medium mb-1">Best</p>
                <p className="text-2xl font-bold text-primary">
                  {streakLoading ? "-" : streak?.longestStreak ?? 0}
                </p>
                <p className="text-xs text-muted-foreground">days</p>
              </div>
              <div className="bg-muted p-3 rounded-xl text-center">
                <p className="text-xs text-muted-foreground font-medium mb-1">Points</p>
                <p className="text-2xl font-bold text-yellow-500">
                  {streakLoading ? "-" : streak?.totalPoints ?? 0}
                </p>
                <p className="text-xs text-muted-foreground">total</p>
              </div>
            </div>

            {streak?.lastCheckinTxHash && (
              <a
                href={`https://explorer.monad.xyz/tx/${streak.lastCheckinTxHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-xs text-violet-600 hover:text-violet-800 transition-colors"
              >
                <Link2 className="h-3 w-3 flex-shrink-0" />
                Last check-in on Monad:{" "}
                <span className="font-mono">
                  {streak.lastCheckinTxHash.slice(0, 10)}…{streak.lastCheckinTxHash.slice(-6)}
                </span>
                <ExternalLink className="h-3 w-3 flex-shrink-0" />
              </a>
            )}

            <Button
              className="w-full h-12 text-lg gap-2"
              onClick={handleCheckin}
              disabled={streak?.checkedInToday || isCheckinPending || checkinState === "done"}
            >
              {isCheckinPending && <Loader2 className="h-5 w-5 animate-spin" />}
              {!isCheckinPending && contractDeployed && !streak?.checkedInToday && (
                <Link2 className="h-5 w-5" />
              )}
              {checkinLabel()}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Invite Codes */}
      <Card>
        <CardHeader>
          <CardTitle>Invite Codes</CardTitle>
          <CardDescription>
            Share these to invite friends. Like posts 5 days in a row to earn bonus codes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {!invites || invites.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No invite codes yet. Keep your streak going to earn them!
              </p>
            ) : (
              invites.map((invite) => (
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
                    {invite.used ? (
                      "Used"
                    ) : copiedCode === invite.code ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : (
                      <><Copy className="h-4 w-4 mr-2" /> Copy</>
                    )}
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
