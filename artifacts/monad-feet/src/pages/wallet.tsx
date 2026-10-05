import { Link } from "wouter";
import { useGetStreak } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Wallet, Coins, ExternalLink, History } from "lucide-react";
import { useAccount, useBalance } from "wagmi";
import { formatUnits } from "viem";
import { MONAD_MAINNET_CHAIN_ID } from "@/lib/contract";
import { useUser } from "@/context/UserContext";
import { format } from "date-fns";

export default function WalletPage() {
  const { address } = useAccount();
  const { user } = useUser();
  const { data: streak } = useGetStreak();
  const { data: monBalance, isLoading: balanceLoading } = useBalance({ address, chainId: MONAD_MAINNET_CHAIN_ID });
  const txHistory: { label: string; sublabel: string; txHash: string; at?: string }[] = [];
  if (user?.registrationTxHash) txHistory.push({ label: "Registered on Monad Feet", sublabel: "On-chain registration", txHash: user.registrationTxHash, at: user.createdAt });
  if (streak?.lastCheckinTxHash) txHistory.push({ label: "Daily Streak Check-In", sublabel: `Streak: ${streak.currentStreak} days`, txHash: streak.lastCheckinTxHash });
  return <div className="space-y-6">
    <div><h1 className="text-3xl font-bold tracking-tight">Wallet</h1><p className="text-muted-foreground">Your balances and signed transactions on Monad.</p></div>
    <Card className="bg-gradient-to-br from-primary/5 to-accent/20 border-primary/20">
      <CardHeader><CardTitle className="flex items-center gap-2"><Wallet className="h-5 w-5 text-primary" /> Balances</CardTitle></CardHeader>
      <CardContent className="space-y-5">
        <div><p className="text-sm font-medium text-muted-foreground mb-1">MON Balance</p><p className="text-4xl font-bold">{balanceLoading ? "..." : monBalance ? Number(formatUnits(monBalance.value, monBalance.decimals)).toFixed(4) : "0.0000"} <span className="text-lg text-primary">MON</span></p>
          {address && <a href={`https://monvision.io/address/${address}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground mt-1">{address.slice(0, 6)}…{address.slice(-4)} <ExternalLink className="h-3 w-3" /></a>}
        </div>
        <div><p className="text-sm font-medium text-muted-foreground mb-1">Points</p><p className="text-3xl font-bold flex items-center"><Coins className="h-6 w-6 text-yellow-500 mr-1.5" />{streak?.totalPoints ?? 0}</p><p className="text-xs text-muted-foreground mt-1">Server-tracked points are not tokens. They are intended for future $MFEET conversion, with no guarantee, date or rate promised.</p></div>
        {address && <Button variant="outline" className="w-full" asChild><a href={`https://monvision.io/address/${address}`} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-4 w-4 mr-2" /> View on Monad Explorer</a></Button>}
      </CardContent>
    </Card>
    <Button asChild variant="outline"><Link href="/daily" data-testid="link-daily-rewards">Daily check-in, rewards and invite codes</Link></Button>
    {txHistory.length > 0 && <Card>
      <CardHeader><CardTitle className="flex items-center gap-2 text-base"><History className="h-4 w-4 text-primary" /> On-Chain Activity</CardTitle><CardDescription>Your signed transactions on Monad</CardDescription></CardHeader>
      <CardContent><div className="divide-y divide-border/50">{txHistory.map(tx => <div key={tx.txHash} className="flex items-center justify-between gap-3 py-3">
        <div><p className="text-sm font-medium">{tx.label}</p><p className="text-xs text-muted-foreground">{tx.sublabel}</p>{tx.at && <p className="text-xs text-muted-foreground">{format(new Date(tx.at), "MMM d, yyyy")}</p>}</div>
        <a href={`https://monvision.io/tx/${tx.txHash}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-primary font-mono shrink-0">{tx.txHash.slice(0, 8)}…{tx.txHash.slice(-6)}<ExternalLink className="h-3 w-3" /></a>
      </div>)}</div>
        {address && <a href={`https://monvision.io/address/${address}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 pt-3 text-xs text-muted-foreground"><ExternalLink className="h-3 w-3" />View all transactions on Monad Explorer</a>}
      </CardContent>
    </Card>}
  </div>;
}