import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetDailyBonus, useClaimDailyBonus, getGetDailyBonusQueryKey, getGetStreakQueryKey, getGetUserQueryKey,
} from "@workspace/api-client-react";
import { Gift, CheckCircle2, Loader2, RefreshCw, ArrowRight, Clock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useUser } from "@/context/UserContext";
import { useToast } from "@/hooks/use-toast";

function useCountdown(target?: string) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const end = target ? new Date(target).getTime() : NaN;
  if (!Number.isFinite(end)) return { label: "--:--:--", ms: NaN };
  const ms = Math.max(0, end - now);
  const s = Math.floor(ms / 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return { label: `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`, ms };
}

/** One rotating task per UTC day. The server verifies progress and pays the bonus once. */
export function DailyBonus() {
  const { user } = useUser();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const queryKey = [...getGetDailyBonusQueryKey(), user?.id ?? "signed-out"];
  const bonus = useGetDailyBonus({
    query: { queryKey, enabled: !!user?.id, refetchOnWindowFocus: true, refetchInterval: 30_000 },
  });
  const claim = useClaimDailyBonus();
  const d = bonus.data;
  const countdown = useCountdown(d?.nextResetAt);

  const resetFired = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (d && countdown.ms === 0 && resetFired.current !== d.nextResetAt) {
      resetFired.current = d.nextResetAt;
      void bonus.refetch();
    }
  }, [countdown.ms, d, bonus]);

  const doClaim = () => {
    if (!d || !d.eligible || d.claimed || claim.isPending) return;
    claim.mutate(undefined, {
      onSuccess: (res) => {
        queryClient.setQueryData(queryKey, res);
        queryClient.invalidateQueries({ queryKey: getGetStreakQueryKey() });
        if (user?.id) queryClient.invalidateQueries({ queryKey: getGetUserQueryKey(user.id) });
        toast({ title: "Daily bonus claimed", description: `+${res.task.points} points added.` });
      },
      onError: (e) => {
        toast({ title: "Could not claim the bonus", description: e instanceof Error ? e.message.split("\n")[0] : "Try again in a moment.", variant: "destructive" });
        void bonus.refetch();
      },
    });
  };

  const pct = d ? Math.min(100, Math.round((d.progress / Math.max(1, d.task.target)) * 100)) : 0;
  // Map server hrefs onto real client routes ("/" is the public landing, private feed lives at /private).
  const ROUTE_FIX: Record<string, string> = { "/": "/feed", "/private-feed": "/private" };
  const taskHref = d?.task.href ? (ROUTE_FIX[d.task.href] ?? d.task.href) : "";
  const internal = taskHref.startsWith("/");

  return (
    <Card id="daily-bonus" className="relative overflow-hidden border-primary/25" data-testid="card-daily-bonus">
      <div className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full bg-accent/60 blur-2xl dark:bg-accent/30" aria-hidden />
      <CardHeader className="relative">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2"><Gift className="h-5 w-5 text-primary" /> Daily bonus</CardTitle>
            <CardDescription>A new task every UTC day. Finish it, then claim your points.</CardDescription>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 font-mono text-[11px] text-muted-foreground" data-testid="text-bonus-reset">
            <Clock className="h-3 w-3" /> {countdown.label}
          </span>
        </div>
      </CardHeader>
      <CardContent className="relative space-y-4">
        {bonus.isLoading ? (
          <div className="space-y-3"><Skeleton className="h-6 w-2/3" /><Skeleton className="h-2 w-full" /><Skeleton className="h-10 w-full" /></div>
        ) : bonus.isError || !d ? (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm" role="alert">
            <span>Could not load today's bonus.</span>
            <Button size="sm" variant="outline" onClick={() => void bonus.refetch()} data-testid="button-retry-bonus"><RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Retry</Button>
          </div>
        ) : (
          <>
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-lg font-semibold leading-snug" data-testid="text-bonus-task">{d.task.title}</p>
              <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-0.5 text-sm font-bold text-primary" data-testid="text-bonus-points">+{d.task.points}</span>
            </div>
            <div>
              <div className="h-2.5 overflow-hidden rounded-full bg-muted">
                <div className={`h-full rounded-full transition-transform duration-700 origin-left ${d.claimed ? "bg-green-500" : "bg-primary"}`} style={{ width: "100%", transform: `scaleX(${pct / 100})` }} />
              </div>
              <div className="mt-1.5 flex justify-between text-xs text-muted-foreground">
                <span data-testid="text-bonus-progress">{Math.min(d.progress, d.task.target)} of {d.task.target}</span>
                <span>{d.claimed ? "Claimed today" : d.eligible ? "Ready to claim" : `${Math.max(0, d.task.target - d.progress)} to go`}</span>
              </div>
            </div>
            {d.claimed ? (
              <div className="flex items-center gap-2 rounded-lg bg-green-50 px-3 py-2.5 text-sm font-medium text-green-700" data-testid="status-bonus-claimed">
                <CheckCircle2 className="h-4 w-4" /> Done. A new task arrives at 00:00 UTC.
              </div>
            ) : d.eligible ? (
              <Button className="h-11 w-full gap-2" onClick={doClaim} disabled={claim.isPending} data-testid="button-claim-bonus">
                {claim.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Gift className="h-4 w-4" />}
                Claim {d.task.points} points
              </Button>
            ) : taskHref ? (
              internal ? (
                <Link href={taskHref} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md border border-input bg-background text-sm font-medium hover:bg-muted" data-testid="link-bonus-task">
                  Go do it <ArrowRight className="h-4 w-4" />
                </Link>
              ) : (
                <a href={taskHref} target="_blank" rel="noopener noreferrer" className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md border border-input bg-background text-sm font-medium hover:bg-muted" data-testid="link-bonus-task">
                  Go do it <ArrowRight className="h-4 w-4" />
                </a>
              )
            ) : null}
            {bonus.isFetching && !bonus.isLoading && <p className="text-[11px] text-muted-foreground">Checking progress</p>}
          </>
        )}
      </CardContent>
    </Card>
  );
}
