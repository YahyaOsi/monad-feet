import { useState, useCallback, useEffect, useRef, type ReactNode } from "react";
import { useDailyCheckin, useGetStreak, useGetMyInvites, useGetUser, getGetMyInvitesQueryKey, getGetUserQueryKey, getGetStreakQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { Flame, Copy, CheckCircle2, ExternalLink, Loader2, Coins } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useContractActions } from "@/lib/useContractActions";
import { useOnChainUser } from "@/lib/useOnChain";
import { useInvalidateGame } from "@/lib/game";
import { CONTRACT_DEPLOYED, MONAD_FEET_CONTRACT_ADDRESS } from "@/lib/contract";
import { useUser } from "@/context/UserContext";
import { useInviteCodeAlert } from "@/hooks/usePresence";
import { useToast } from "@/hooks/use-toast";
import { CommunityRewards } from "@/components/daily/CommunityRewards";
import { DailyBonus } from "@/components/daily/DailyBonus";
import { getGetDailyBonusQueryKey } from "@workspace/api-client-react";

interface PendingCheckin { txHash: string; wallet: string; status: "submitted" | "confirmed"; at: number }
const checkinKey = (wallet: string) =>
  `mf_checkin_pending:${wallet.toLowerCase()}:${MONAD_FEET_CONTRACT_ADDRESS.toLowerCase()}`;
function readPendingCheckin(wallet?: string): PendingCheckin | null {
  if (!wallet) return null;
  try {
    const v = JSON.parse(localStorage.getItem(checkinKey(wallet)) ?? "null");
    return v && typeof v.txHash === "string" && v.wallet?.toLowerCase() === wallet.toLowerCase() ? v : null;
  } catch { return null; }
}
function writePendingCheckin(wallet: string, v: PendingCheckin | null): boolean {
  try {
    if (v) localStorage.setItem(checkinKey(wallet), JSON.stringify(v));
    else localStorage.removeItem(checkinKey(wallet));
    return true;
  } catch { return false; }
}
const HASH_RE = /^0x[0-9a-fA-F]{64}$/;
type CheckinState = "idle" | "signing" | "syncing" | "done" | "error";

/** Wallet rewards, with the existing spa placed between check in and milestones. */
export function DailyRewards({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const invalidateGame = useInvalidateGame();
  const { address: connectedAddress } = useAccount();
  const { user } = useUser();
  const address = connectedAddress?.toLowerCase() === user?.walletAddress?.toLowerCase() ? connectedAddress : undefined;
  const { data: streak, isLoading: streakLoading, error: streakError, refetch: refetchStreak } = useGetStreak({
    query: { queryKey: [...getGetStreakQueryKey(), user?.id ?? "signed-out", address?.toLowerCase() ?? "none"], enabled: !!user?.id, refetchOnWindowFocus: true },
  });
  const { data: invites, isLoading: invitesLoading, error: invitesError } = useGetMyInvites({
    query: {
      queryKey: [...getGetMyInvitesQueryKey(), user?.id ?? "signed-out"],
      enabled: !!user?.id,
      refetchInterval: 60_000,
      refetchIntervalInBackground: false,
      refetchOnMount: "always",
      refetchOnWindowFocus: true,
    },
  });
  const { data: myProfile } = useGetUser(user?.id ?? 0, { query: { enabled: !!user?.id, queryKey: getGetUserQueryKey(user?.id ?? 0) } });
  const myPostCount = myProfile?.postCount ?? 0;
  const { toast } = useToast();
  const handleInviteCodesEarned = useCallback((codes: number, reason: string) => {
    queryClient.invalidateQueries({ queryKey: getGetMyInvitesQueryKey() });
    if (user?.id) queryClient.invalidateQueries({ queryKey: getGetUserQueryKey(user.id) });
    toast({ title: `You earned ${codes} invite code${codes > 1 ? "s" : ""}`, description: `Reward for ${reason}. Check below to copy and share them.` });
  }, [queryClient, user?.id, toast]);
  useInviteCodeAlert(handleInviteCodesEarned);
  const { contractDeployed, dailyCheckinOnChain } = useContractActions();
  const { data: onChainUser } = useOnChainUser(address);
  const chainStreak = onChainUser?.[6] !== undefined ? Number(onChainUser[6]) : null;
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [checkinState, setCheckinState] = useState<CheckinState>("idle");
  const [checkinError, setCheckinError] = useState<string | null>(null);
  const checkinMutation = useDailyCheckin();
  const [pendingCheckin, setPendingCheckin] = useState<PendingCheckin | null>(null);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const [manualCheckinHash, setManualCheckinHash] = useState("");
  const addressRef = useRef(address);
  addressRef.current = address;
  const sameWallet = (w: string) => addressRef.current?.toLowerCase() === w.toLowerCase();

  useEffect(() => {
    setCheckinState("idle");
    setCheckinError(null);
    setStorageWarning(null);
    setManualCheckinHash("");
    setCopiedCode(null);
    setPendingCheckin(readPendingCheckin(address));
  }, [address]);
  useEffect(() => {
    if (pendingCheckin && streak?.lastCheckinTxHash
      && streak.lastCheckinTxHash.toLowerCase() === pendingCheckin.txHash.toLowerCase()) {
      writePendingCheckin(pendingCheckin.wallet, null);
      setPendingCheckin(null);
    }
  }, [pendingCheckin, streak?.lastCheckinTxHash]);
  const autoRetried = useRef<string | null>(null);
  useEffect(() => {
    if (!pendingCheckin || streakLoading || streak?.checkedInToday || checkinState !== "idle") return;
    if (autoRetried.current === pendingCheckin.txHash) return;
    autoRetried.current = pendingCheckin.txHash;
    void syncCheckin(pendingCheckin);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingCheckin, streakLoading, streak?.checkedInToday, checkinState]);
  const savePending = (v: PendingCheckin) => {
    if (sameWallet(v.wallet)) setPendingCheckin(v);
    if (!writePendingCheckin(v.wallet, v) && sameWallet(v.wallet)) {
      setStorageWarning(`Browser storage failed. Copy this hash to recover later: ${v.txHash}`);
    }
  };
  /** Submit an existing hash to the app. Never opens the wallet. */
  const syncCheckin = async (rec: PendingCheckin) => {
    if (!sameWallet(rec.wallet)) return;
    setCheckinError(null);
    setCheckinState("syncing");
    try {
      await checkinMutation.mutateAsync({ data: { txHash: rec.txHash } });
      if (!sameWallet(rec.wallet)) return;
      writePendingCheckin(rec.wallet, null);
      setPendingCheckin(null);
      setManualCheckinHash("");
      queryClient.invalidateQueries({ queryKey: getGetStreakQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetDailyBonusQueryKey() });
      invalidateGame();
      if (user?.id) queryClient.invalidateQueries({ queryKey: getGetUserQueryKey(user.id) });
      setCheckinState("done");
    } catch (e) {
      if (!sameWallet(rec.wallet)) return;
      const detail = e instanceof Error ? e.message.split("\n")[0] : "request failed";
      setCheckinError(rec.status === "confirmed"
        ? `Receipt for ${rec.txHash.slice(0, 10)}… was confirmed on chain, but the app has not recorded it yet (${detail}). The hash is saved; "Retry sync" resubmits the same transaction without opening your wallet.`
        : `The app could not verify ${rec.txHash.slice(0, 10)}… (${detail}). Nothing was recorded. If this transaction has not confirmed yet, retry in a moment.`);
      setCheckinState("error");
      void refetchStreak();
    }
  };
  const chainRegistered = onChainUser ? Boolean(onChainUser[0]) : null;
  const chainPoints = onChainUser?.[5] !== undefined ? String(onChainUser[5]) : null;
  const handleCheckin = async () => {
    if (streak?.checkedInToday || (checkinState !== "idle" && checkinState !== "error")) return;
    const wallet = address;
    if (!wallet) return;
    const saved = readPendingCheckin(wallet) ?? pendingCheckin;
    if (saved && sameWallet(saved.wallet)) { await syncCheckin(saved); return; }
    setCheckinError(null);
    if (!contractDeployed) { setCheckinError("Onchain check in is unavailable."); setCheckinState("error"); return; }
    if (chainRegistered === false) { setCheckinError("unregistered"); setCheckinState("error"); return; }
    let submitted: string | null = null;
    setCheckinState("signing");
    try {
      const txHash = await dailyCheckinOnChain((h) => {
        submitted = h;
        savePending({ txHash: h, wallet, status: "submitted", at: Date.now() });
      });
      if (!txHash) throw new Error("No transaction hash returned.");
      const rec: PendingCheckin = { txHash, wallet, status: "confirmed", at: Date.now() };
      savePending(rec);
      queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === "readContract" });
      await syncCheckin(rec);
    } catch (e) {
      if (!sameWallet(wallet)) return;
      const msg = e instanceof Error ? e.message.split("\n")[0] : "Transaction was not confirmed.";
      setCheckinError(submitted
        ? `${msg}. Transaction ${String(submitted).slice(0, 10)}… was submitted but this app did not see a successful receipt. The hash is saved; "Retry sync" asks the app to verify it without a new wallet prompt.`
        : msg);
      setCheckinState("error");
    }
  };
  const submitManualCheckin = async () => {
    const h = manualCheckinHash.trim();
    if (!address) return;
    if (!HASH_RE.test(h)) { setCheckinError("Paste a full 0x transaction hash (64 hex characters)."); return; }
    const rec: PendingCheckin = { txHash: h, wallet: address, status: "submitted", at: Date.now() };
    savePending(rec);
    await syncCheckin(rec);
  };
  const forgetPendingCheckin = () => {
    if (!pendingCheckin) return;
    writePendingCheckin(pendingCheckin.wallet, null);
    setPendingCheckin(null);
    setCheckinError(null);
    setCheckinState("idle");
  };
  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedCode(text);
      setTimeout(() => setCopiedCode(null), 2000);
    } catch { toast({ title: "Could not copy", description: "Select and copy the invite code manually.", variant: "destructive" }); }
  };
  const checkinLabel = () => {
    if (streak?.checkedInToday || checkinState === "done") return "Checked in today";
    if (checkinState === "signing") return "Sign in your wallet";
    if (checkinState === "syncing") return "Syncing";
    if (pendingCheckin) return "Retry sync (no new transaction)";
    if (checkinState === "error") return "Try again";
    return contractDeployed ? "Sign and check in on Monad" : "Check In Now";
  };
  const isCheckinPending = checkinState === "signing" || checkinState === "syncing";
  const dbStreak = streak?.currentStreak ?? 0;
  const streakMismatch = CONTRACT_DEPLOYED && chainStreak !== null && chainStreak !== dbStreak;
  const currentPoints = streak?.totalPoints ?? 0;
  const milestones = [
    { label: "Day 2 streak", current: dbStreak, target: 2, reward: "1 invite + 10 points" },
    { label: "Day 5 streak", current: dbStreak, target: 5, reward: "1 invite + 50 points" },
    { label: "Day 7 streak", current: dbStreak, target: 7, reward: "2 invites + 100 points" },
    { label: "5 posts", current: myPostCount, target: 5, reward: "1 invite + 10 points" },
    { label: "10 posts", current: myPostCount, target: 10, reward: "1 invite + 10 points" },
  ];

  return <>
    <Card id="daily-checkin">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Flame className="h-5 w-5 text-orange-500" /> Daily Streak</CardTitle>
        <CardDescription>Start with 10 points at registration. Check in for +10 points once per UTC day (resets at 00:00 UTC). One time milestones add extra rewards. Buying a spa treatment does not check you in.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {streakError && <p role="alert" className="text-sm text-destructive">Could not load check in progress. Refresh to try again.</p>}
        <div className="grid grid-cols-3 gap-3">
          {[["Current", dbStreak, "days"], ["Best", streak?.longestStreak ?? 0, "days"], ["Points", currentPoints, "total"]].map(([label, value, unit]) => <div key={label} className="rounded-xl bg-muted p-3 text-center">
            <p className="text-xs text-muted-foreground">{label}</p><p className="text-2xl font-bold text-primary">{streakLoading ? "-" : value}</p><p className="text-xs text-muted-foreground">{unit}</p>
          </div>)}
        </div>
        {(() => {
          const ext = streak as (typeof streak & { syncPending?: boolean | null; syncError?: string | null }) | undefined;
          if (!ext?.syncPending && !ext?.syncError) return null;
          return <div role="status" className="rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-xs text-amber-900 dark:text-amber-200" data-testid="status-streak-sync">
            <p className="font-medium">{ext.syncPending ? "Your latest check in is still syncing with the app." : "Your latest check in did not sync."}</p>
            {ext.syncError && <p className="mt-1">{ext.syncError}</p>}
            <p className="mt-1">Your streak may look behind until it syncs. Check again, retry your saved receipt, or paste the tx hash below. Do not check in again until this clears.</p>
            <Button size="sm" variant="outline" className="mt-2" onClick={() => void refetchStreak()} data-testid="button-refresh-streak-sync">Check again</Button>
          </div>;
        })()}
        {streakMismatch && <p className="text-xs text-muted-foreground">Onchain streak ({chainStreak}d) differs from server reward streak ({dbStreak}d). Server rewards use the server streak.</p>}
        {streak?.lastCheckinTxHash && <a href={`https://monvision.io/tx/${streak.lastCheckinTxHash}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-xs text-primary">Last check in: {streak.lastCheckinTxHash.slice(0, 10)}…{streak.lastCheckinTxHash.slice(-6)} <ExternalLink className="h-3 w-3" /></a>}
        <Button className="w-full h-12 gap-2" onClick={handleCheckin} disabled={!address || streakLoading || !!streakError || streak?.checkedInToday || isCheckinPending || checkinState === "done"} data-testid="button-daily-checkin">
          {isCheckinPending && <Loader2 className="h-5 w-5 animate-spin" />}{checkinLabel()}
        </Button>
        {!address && <p className="text-xs text-destructive">Connect the wallet for your signed in account to check in.</p>}
        {chainRegistered === false && <p className="text-xs text-muted-foreground" data-testid="text-checkin-unregistered">Register your wallet on the new contract below before checking in.</p>}
        {checkinError && checkinError !== "unregistered" && <p className="text-xs text-destructive" data-testid="text-checkin-error">{checkinError}</p>}
        {storageWarning && <p className="text-xs text-destructive break-all" data-testid="text-checkin-storage-warning">{storageWarning}</p>}
        {pendingCheckin && <div className="flex items-center justify-between gap-2 rounded-lg border p-3 text-xs" data-testid="row-pending-checkin">
          <span>Saved check in <a href={`https://monvision.io/tx/${pendingCheckin.txHash}`} target="_blank" rel="noreferrer" className="font-mono text-primary underline">{pendingCheckin.txHash.slice(0, 10)}…{pendingCheckin.txHash.slice(-6)}</a> ({pendingCheckin.status === "confirmed" ? "receipt confirmed, not yet recorded by app" : "receipt not confirmed by this browser"})</span>
          <Button size="sm" variant="ghost" onClick={forgetPendingCheckin} disabled={isCheckinPending} data-testid="button-forget-pending-checkin">Forget</Button>
        </div>}
        {(!streak?.checkedInToday || (streak as typeof streak & { syncError?: string | null })?.syncError) && !pendingCheckin && <div className="flex flex-col gap-2 sm:flex-row">
          <Input value={manualCheckinHash} onChange={(e) => setManualCheckinHash(e.target.value)} placeholder="Already checked in onchain? Paste the tx hash" className="font-mono text-xs" data-testid="input-manual-checkin-hash" />
          <Button size="sm" variant="outline" onClick={submitManualCheckin} disabled={!address || isCheckinPending || !manualCheckinHash.trim()} data-testid="button-submit-manual-checkin">Recover</Button>
        </div>}
        <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">Check in transaction details</summary>
          <p className="mt-2">Check in has no treatment fee; Monad network gas is required. This is an early unaudited contract. Recovery verifies the original receipt without a new transaction.</p>
          {chainPoints !== null && <p className="mt-2" data-testid="text-contract-points">Contract points: <span className="font-mono">{chainPoints}</span>. A separate onchain balance (the contract's 5, 10 and 20 point check in tiers plus game rewards), not the app points above (+10 per check in plus milestones).</p>}
        </details>
      </CardContent>
    </Card>
    {children}
    <DailyBonus />
    <Card>
      <CardHeader><CardTitle>One time milestone progress</CardTitle><CardDescription>These bonuses are in addition to the daily +10 baseline. Codes and points are awarded once per account.</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        {milestones.map(({ label, current, target, reward }) => {
          const done = current >= target;
          return <div key={label} className="space-y-1.5">
            <div className="flex items-center justify-between gap-2 text-sm"><span className="flex items-center gap-2 font-medium">{done && <CheckCircle2 className="h-4 w-4 text-green-600" />}{label}</span><span className="text-xs text-muted-foreground">+{reward}</span></div>
            <div className="h-2 rounded-full overflow-hidden bg-muted"><div className={`h-full rounded-full ${done ? "bg-green-500" : "bg-primary"}`} style={{ width: `${Math.min(100, Math.round(current / target * 100))}%` }} /></div>
            <div className="flex justify-between text-xs text-muted-foreground"><span>{current} / {target}</span><span>{done ? "Earned" : `${Math.max(0, target - current)} more to go`}</span></div>
          </div>;
        })}
        <p className="text-xs text-muted-foreground">Codes appear automatically in the Invite Codes section below once earned.</p>
      </CardContent>
    </Card>
    <CommunityRewards key={user?.id ?? "signed-out"} />
    <Card id="invite-codes">
      <CardHeader><CardTitle>Invite Codes</CardTitle><CardDescription>Each code lets one friend join. It is marked Used when they finish signing up and cannot be used again. Referrals earn 10, 20, 30, 40 then 50 points per friend (capped at 50 each).</CardDescription></CardHeader>
      <CardContent className="space-y-3">
        {invitesLoading ? <p className="text-sm text-muted-foreground">Loading invite codes…</p> : invitesError ? <p role="alert" className="text-sm text-destructive">Could not load invite codes. Refresh to try again.</p> : !invites?.length ? <div className="text-center py-6 text-muted-foreground"><Coins className="h-8 w-8 mx-auto mb-2 opacity-30" /><p className="text-sm">No invite codes yet.</p><p className="text-xs mt-1">Reach day 2 of your streak or publish 5 posts to earn one.</p></div> : invites.map((invite) => <div key={invite.id} className="flex gap-3 p-3 bg-muted rounded-lg">
          <Input value={invite.code} readOnly className="font-mono text-center tracking-widest bg-background flex-1 min-w-0" data-testid={`input-invite-${invite.id}`} />
          <Button variant={invite.used ? "secondary" : "default"} disabled={invite.used} onClick={() => void copyToClipboard(invite.code)} className="w-28 shrink-0" data-testid={`button-copy-invite-${invite.id}`}>{invite.used ? "Used" : copiedCode === invite.code ? <><CheckCircle2 className="h-4 w-4 mr-1" /> Copied</> : <><Copy className="h-4 w-4 mr-1" /> Copy</>}</Button>
        </div>)}
      </CardContent>
    </Card>
  </>;
}