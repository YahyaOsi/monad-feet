import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useGetXRewards, useClaimXReward, getGetXRewardsQueryKey, getGetStreakQueryKey, getGetMyInvitesQueryKey } from "@workspace/api-client-react";
import { ExternalLink, Check, Info } from "lucide-react";
import { SiX } from "react-icons/si";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const TASKS = [
  { id: "follow", title: "Follow @MonadFeet", href: "https://x.com/intent/follow?screen_name=MonadFeet" },
  { id: "like", title: "Like a @MonadFeet post", href: "https://x.com/MonadFeet" },
  { id: "comment", title: "Comment on a @MonadFeet post", href: "https://x.com/MonadFeet" },
  { id: "notifications", title: "Turn on @MonadFeet notifications", href: "https://x.com/MonadFeet" },
  { id: "post_x", title: "Write a post about @MonadFeet", href: "https://x.com/intent/tweet?text=" + encodeURIComponent("I'm earning rewards and building my streak with @MonadFeet! 👣") },
] as const;

export function XCommunityTasks() {
  const { data, isLoading, error } = useGetXRewards({ query: { queryKey: getGetXRewardsQueryKey(), refetchInterval: 60_000 } });
  const claim = useClaimXReward();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<string | null>(null);
  const [claimError, setClaimError] = useState("");
  const [lastReward, setLastReward] = useState("");
  const submit = async (id: typeof TASKS[number]["id"]) => {
    setPending(id);
    setClaimError("");
    try {
      const result = await claim.mutateAsync({ task: id });
      setLastReward(result.claimed ? `Earned ${result.points} points${result.invites ? ` and ${result.invites} invite code` : ""}.` : "Already claimed.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getGetXRewardsQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getGetStreakQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getGetMyInvitesQueryKey() }),
      ]);
    } catch (e) {
      setClaimError(e instanceof Error ? e.message : "Claim failed. Please try again.");
    } finally {
      setPending(null);
    }
  };

  return (
    <Card className="rounded-2xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><SiX className="h-4 w-4" /> Community on X</CardTitle>
        <CardDescription>Self-report completed actions to earn points. X activity is not verified.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">Follow, like, comment and notifications: 5 points each, once per account. Write a post: 10 points total once per UTC day; if you also claimed yesterday (UTC), earn 1 invite code alongside those 10 points (not extra points). Resets at 00:00 UTC.</p>
        {isLoading && <p className="text-sm">Loading rewards…</p>}
        {error && <p role="alert" className="text-sm text-destructive">Could not load reward status: {error instanceof Error ? error.message : "Unknown error"}</p>}
        {data && <p className="text-xs text-muted-foreground">Current UTC day: {data.utcDay} · Consecutive post bonus {data.postStreakEligible ? "available" : "not yet available"}</p>}
        {data && <ul className="space-y-2">
          {TASKS.map(t => {
            const done = t.id === "post_x" ? data.postClaimedToday : !!data.lifetime[t.id];
            return <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3">
              <span className="text-sm font-medium flex items-center gap-2">{done && <Check className="h-4 w-4 text-green-600" />}{t.title} <span className="text-muted-foreground">+{t.id === "post_x" ? "10" : "5"} points</span></span>
              <span className="flex items-center gap-2">
                <a href={t.href} target="_blank" rel="noopener noreferrer" className="text-xs underline inline-flex items-center gap-1">Open X <ExternalLink className="h-3 w-3" /></a>
                <Button size="sm" variant={done ? "secondary" : "default"} disabled={done || !!pending} onClick={() => void submit(t.id)}>{done ? "Claimed" : pending === t.id ? "Claiming…" : "Claim the points"}</Button>
              </span>
            </li>;
          })}
        </ul>}
        {lastReward && <p role="status" className="text-sm text-green-700">{lastReward}</p>}
        {claimError && <p role="alert" className="text-sm text-destructive">{claimError}</p>}
        <p className="flex items-start gap-2 text-xs text-muted-foreground"><Info className="h-3.5 w-3.5 shrink-0" /> Clicking Open X does not claim a reward. Only confirm after doing the action. Rewards are stored on your account.</p>
      </CardContent>
    </Card>
  );
}