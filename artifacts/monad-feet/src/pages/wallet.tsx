import { useState } from "react";
import { useGetStreak, useGetMyInvites, useGetUser } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Wallet, Coins, Flame, Copy, CheckCircle2, ExternalLink,
  Loader2, Link2, History, AlertTriangle, Zap, TrendingUp
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetStreakQueryKey } from "@workspace/api-client-react";
import { useAccount, useBalance } from "wagmi";
import { formatUnits } from "viem";
import { useContractActions } from "@/lib/useContractActions";
import { useOnChainUser } from "@/lib/useOnChain";
import { CONTRACT_DEPLOYED, MONAD_MAINNET_CHAIN_ID } from "@/lib/contract";
import { useUser } from "@/context/UserContext";
import { format } from "date-fns";

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

type CheckinState = "idle" | "signing" | "syncing" | "done" | "error";

// $MFEET airdrop tiers based on points
const AIRDROP_TIERS = [
  { minPoints: 0, label: "Bronze", allocation: 100, color: "text-amber-700 bg-amber-50 border-amber-200" },
  { minPoints: 50, label: "Silver", allocation: 500, color: "text-gray-600 bg-gray-50 border-gray-200" },
  { minPoints: 200, label: "Gold", allocation: 2000, color: "text-yellow-600 bg-yellow-50 border-yellow-200" },
  { minPoints: 500, label: "Diamond", allocation: 7500, color: "text-blue-600 bg-blue-50 border-blue-200" },
  { minPoints: 1000, label: "Legend", allocation: 20000, color: "text-violet-600 bg-violet-50 border-violet-200" },
];

function getAirdropTier(points: number) {
  let tier = AIRDROP_TIERS[0];
  for (const t of AIRDROP_TIERS) {
    if (points >= t.minPoints) tier = t;
  }
  return tier;
}

function getNextTier(points: number) {
  for (const t of AIRDROP_TIERS) {
    if (points < t.minPoints) return t;
  }
  return null;
}

export default function WalletPage() {
  const queryClient = useQueryClient();
  const { address } = useAccount();
  const { user } = useUser();
  const { data: streak, isLoading: streakLoading } = useGetStreak();
  const { data: invites } = useGetMyInvites();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: myProfile } = useGetUser(user?.id ?? 0, { query: { enabled: !!user?.id, queryKey: [] as any } });
  const myPostCount = myProfile?.postCount ?? 0;
  const { contractDeployed, dailyCheckinOnChain } = useContractActions();

  const { data: monBalance, isLoading: balanceLoading } = useBalance({
    address,
    chainId: MONAD_MAINNET_CHAIN_ID,
  });

  const { data: onChainUser } = useOnChainUser(address);

  const chainStreak = onChainUser?.[6] !== undefined ? Number(onChainUser[6]) : null;
  const chainPoints = onChainUser?.[5] !== undefined ? Number(onChainUser[5]) : null;

  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [checkinState, setCheckinState] = useState<CheckinState>("idle");

  const handleCheckin = async () => {
    if (streak?.checkedInToday || checkinState !== "idle") return;

    let txHash: string | null = null;
    if (contractDeployed) {
      setCheckinState("signing");
      try {
        txHash = await dailyCheckinOnChain();
      } catch {
        // user declined
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
    return contractDeployed ? "Sign & Check In on Monad" : "Check In Now";
  };

  const isCheckinPending = checkinState === "signing" || checkinState === "syncing";
  const dbStreak = streak?.currentStreak ?? 0;
  const streakMismatch = CONTRACT_DEPLOYED && chainStreak !== null && chainStreak !== dbStreak;
  const currentPoints = CONTRACT_DEPLOYED && chainPoints !== null ? chainPoints : (streak?.totalPoints ?? 0);
  const currentTier = getAirdropTier(currentPoints);
  const nextTier = getNextTier(currentPoints);

  // Build transaction history
  const txHistory: { label: string; sublabel: string; txHash: string; at?: string }[] = [];
  if (user?.registrationTxHash) {
    txHistory.push({
      label: "Registered on Monad Feet",
      sublabel: "On-chain registration",
      txHash: user.registrationTxHash,
      at: user.createdAt,
    });
  }
  if (streak?.lastCheckinTxHash) {
    txHistory.push({
      label: "Daily Streak Check-In",
      sublabel: `Streak: ${streak.currentStreak} days`,
      txHash: streak.lastCheckinTxHash,
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Wallet & Rewards</h1>
        <p className="text-muted-foreground">Your on-chain assets, streak, and invite codes</p>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Balances */}
        <Card className="bg-gradient-to-br from-primary/5 to-accent/20 border-primary/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wallet className="h-5 w-5 text-primary" /> Balances
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
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
                  href={`https://monvision.io/address/${address}`}
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
              <p className="text-sm font-medium text-muted-foreground mb-1">$MFEET Points</p>
              <div className="flex items-end gap-2">
                <span className="text-3xl font-bold flex items-center">
                  <Coins className="h-6 w-6 text-yellow-500 mr-1.5" />
                  {currentPoints}
                </span>
                {CONTRACT_DEPLOYED && chainPoints !== null && (
                  <span className="text-xs text-violet-600 mb-1 flex items-center gap-0.5 font-semibold">
                    <Link2 className="h-3 w-3" /> on-chain
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1">Streak points convert to $MFEET at TGE</p>
            </div>

            <Button variant="outline" className="w-full" asChild>
              <a href={`https://monvision.io/address/${address}`} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4 mr-2" /> View on Monad Explorer
              </a>
            </Button>
          </CardContent>
        </Card>

        {/* Daily Streak */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Flame className="h-5 w-5 text-orange-500" /> Daily Streak
            </CardTitle>
            <CardDescription>
              {contractDeployed ? "Each check-in is signed on Monad Mainnet" : "Check in daily to earn $MFEET points"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className={`p-3 rounded-xl text-center ${CONTRACT_DEPLOYED && chainStreak !== null ? "bg-violet-50 border border-violet-100" : "bg-muted"}`}>
                <p className="text-xs text-muted-foreground font-medium mb-1 flex items-center justify-center gap-0.5">
                  Current {CONTRACT_DEPLOYED && chainStreak !== null && <Link2 className="h-2.5 w-2.5 text-violet-500" />}
                </p>
                <p className="text-2xl font-bold text-orange-500">
                  {streakLoading ? "-" : (CONTRACT_DEPLOYED && chainStreak !== null ? chainStreak : dbStreak)}
                </p>
                <p className="text-xs text-muted-foreground">days</p>
              </div>
              <div className="bg-muted p-3 rounded-xl text-center">
                <p className="text-xs text-muted-foreground font-medium mb-1">Best</p>
                <p className="text-2xl font-bold text-primary">{streakLoading ? "-" : streak?.longestStreak ?? 0}</p>
                <p className="text-xs text-muted-foreground">days</p>
              </div>
              <div className={`p-3 rounded-xl text-center ${CONTRACT_DEPLOYED && chainPoints !== null ? "bg-violet-50 border border-violet-100" : "bg-muted"}`}>
                <p className="text-xs text-muted-foreground font-medium mb-1 flex items-center justify-center gap-0.5">
                  Points {CONTRACT_DEPLOYED && chainPoints !== null && <Link2 className="h-2.5 w-2.5 text-violet-500" />}
                </p>
                <p className="text-2xl font-bold text-yellow-500">{streakLoading ? "-" : currentPoints}</p>
                <p className="text-xs text-muted-foreground">total</p>
              </div>
            </div>

            {streakMismatch && (
              <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2 border border-amber-200">
                <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                <span>Chain streak ({chainStreak}d) differs from DB ({dbStreak}d). Chain data is authoritative.</span>
              </div>
            )}

            {streak?.lastCheckinTxHash && (
              <a
                href={`https://monvision.io/tx/${streak.lastCheckinTxHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-xs text-violet-600 hover:text-violet-800 transition-colors"
              >
                <Link2 className="h-3 w-3 flex-shrink-0" />
                Last check-in:{" "}
                <span className="font-mono">{streak.lastCheckinTxHash.slice(0, 10)}…{streak.lastCheckinTxHash.slice(-6)}</span>
                <ExternalLink className="h-3 w-3 flex-shrink-0" />
              </a>
            )}

            <Button
              className="w-full h-12 text-base gap-2"
              onClick={handleCheckin}
              disabled={streak?.checkedInToday || isCheckinPending || checkinState === "done"}
              variant={checkinState === "done" || streak?.checkedInToday ? "secondary" : "default"}
            >
              {isCheckinPending && <Loader2 className="h-5 w-5 animate-spin" />}
              {!isCheckinPending && contractDeployed && !streak?.checkedInToday && checkinState !== "done" && (
                <Link2 className="h-5 w-5" />
              )}
              {!isCheckinPending && (streak?.checkedInToday || checkinState === "done") && (
                <CheckCircle2 className="h-5 w-5 text-green-500" />
              )}
              {checkinLabel()}
            </Button>

            {/* Invite code milestones */}
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground">Earn Invite Codes</p>
              {(() => {
                const currentStreak = CONTRACT_DEPLOYED && chainStreak !== null ? chainStreak : dbStreak;
                const milestones = [
                  { label: "7-day streak", done: currentStreak >= 7, reward: "+1 invite code" },
                  { label: "30-day streak", done: currentStreak >= 30, reward: "+3 invite codes" },
                  { label: "10 posts published", done: myPostCount >= 10, reward: "+1 invite code" },
                  { label: "25 posts published", done: myPostCount >= 25, reward: "+1 invite code" },
                ];
                return milestones.map(({ label, done, reward }) => (
                  <div key={label} className={`flex items-center justify-between text-xs px-3 py-1.5 rounded-lg ${done ? "bg-green-50 text-green-700" : "bg-muted text-muted-foreground"}`}>
                    <span className="font-medium">{label}</span>
                    <span className="flex items-center gap-1">
                      {done && <CheckCircle2 className="h-3 w-3" />}
                      {reward}
                    </span>
                  </div>
                ));
              })()}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* $MFEET Airdrop Estimator */}
      <Card className="border-yellow-200 bg-gradient-to-br from-yellow-50/50 to-amber-50/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-yellow-500" /> $MFEET Airdrop Estimator
          </CardTitle>
          <CardDescription>
            Estimated allocation at Token Generation Event based on your streak points
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Current tier */}
          <div className={`rounded-xl border p-4 ${currentTier.color}`}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide opacity-70 mb-1">Current Tier</p>
                <p className="text-2xl font-bold">{currentTier.label}</p>
                <p className="text-sm opacity-80 mt-0.5">{currentPoints} / {nextTier?.minPoints ?? "MAX"} pts</p>
              </div>
              <div className="text-right">
                <p className="text-xs font-semibold uppercase tracking-wide opacity-70 mb-1">Est. Allocation</p>
                <p className="text-3xl font-bold">{currentTier.allocation.toLocaleString()}</p>
                <p className="text-sm opacity-80">$MFEET</p>
              </div>
            </div>

            {/* Progress to next tier */}
            {nextTier && (
              <div className="mt-3">
                <div className="flex justify-between text-xs opacity-70 mb-1">
                  <span>{currentPoints} pts</span>
                  <span>{nextTier.minPoints} pts for {nextTier.label}</span>
                </div>
                <div className="h-2 bg-black/10 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-current opacity-60 rounded-full transition-all"
                    style={{
                      width: `${Math.min(100, (currentPoints / nextTier.minPoints) * 100)}%`
                    }}
                  />
                </div>
                <p className="text-xs opacity-60 mt-1">
                  {nextTier.minPoints - currentPoints} pts to {nextTier.label} ({nextTier.allocation.toLocaleString()} $MFEET)
                </p>
              </div>
            )}
            {!nextTier && (
              <p className="text-xs opacity-70 mt-2 flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" /> Maximum tier achieved!
              </p>
            )}
          </div>

          {/* All tiers */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">All Tiers</p>
            <div className="space-y-1.5">
              {AIRDROP_TIERS.map((tier) => {
                const isCurrentTier = tier.label === currentTier.label;
                const unlocked = currentPoints >= tier.minPoints;
                return (
                  <div
                    key={tier.label}
                    className={`flex items-center justify-between text-xs px-3 py-2 rounded-lg border transition-all ${
                      isCurrentTier ? tier.color + " font-semibold" : unlocked ? "bg-green-50 text-green-700 border-green-200" : "bg-muted text-muted-foreground border-transparent"
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      {unlocked && <CheckCircle2 className="h-3 w-3" />}
                      <TrendingUp className="h-3 w-3" />
                      {tier.label} ({tier.minPoints}+ pts)
                    </span>
                    <span>{tier.allocation.toLocaleString()} $MFEET</span>
                  </div>
                );
              })}
            </div>
          </div>

          <p className="text-[10px] text-muted-foreground text-center">
            * Estimated allocation. Actual $MFEET distribution will be determined at TGE. Keep building your streak!
          </p>
        </CardContent>
      </Card>

      {/* Chain Activity */}
      {txHistory.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <History className="h-4 w-4 text-primary" /> On-Chain Activity
            </CardTitle>
            <CardDescription>Your signed transactions on Monad Mainnet</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-border/50">
              {txHistory.map((tx) => (
                <div key={tx.txHash} className="flex items-center justify-between gap-3 py-3">
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-full bg-violet-100 flex items-center justify-center flex-shrink-0">
                      <Link2 className="h-4 w-4 text-violet-600" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">{tx.label}</p>
                      <p className="text-xs text-muted-foreground">{tx.sublabel}</p>
                      {tx.at && (
                        <p className="text-xs text-muted-foreground/60">{format(new Date(tx.at), "MMM d, yyyy")}</p>
                      )}
                    </div>
                  </div>
                  <a
                    href={`https://monvision.io/tx/${tx.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs text-violet-600 hover:text-violet-800 font-mono transition-colors flex-shrink-0"
                  >
                    {tx.txHash.slice(0, 8)}…{tx.txHash.slice(-6)}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              ))}
            </div>
            {address && (
              <div className="pt-3 mt-3 border-t border-border/50">
                <a
                  href={`https://monvision.io/address/${address}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-xs text-muted-foreground hover:text-violet-600 transition-colors"
                >
                  <ExternalLink className="h-3 w-3" />
                  View all transactions on Monad Explorer
                </a>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Invite Codes */}
      <Card>
        <CardHeader>
          <CardTitle>Invite Codes</CardTitle>
          <CardDescription>Share to invite friends. Earn more by hitting streak milestones.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {!invites || invites.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground">
                <Coins className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">No invite codes yet.</p>
                <p className="text-xs mt-1">Hit a 7-day streak to earn your first code.</p>
              </div>
            ) : (
              invites.map((invite) => (
                <div key={invite.id} className="flex items-center gap-3 p-3 bg-muted rounded-lg">
                  <Input
                    value={invite.code}
                    readOnly
                    className="font-mono text-center tracking-widest bg-background flex-1"
                  />
                  <Button
                    variant={invite.used ? "secondary" : "default"}
                    disabled={invite.used}
                    onClick={() => copyToClipboard(invite.code)}
                    className="w-28 flex-shrink-0"
                  >
                    {invite.used ? (
                      "Used"
                    ) : copiedCode === invite.code ? (
                      <><CheckCircle2 className="h-4 w-4 mr-1" /> Copied</>
                    ) : (
                      <><Copy className="h-4 w-4 mr-1.5" /> Copy</>
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
