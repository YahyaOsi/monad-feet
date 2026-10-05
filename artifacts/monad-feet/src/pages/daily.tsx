import { useEffect, useRef, useState } from "react";
import { DailyRewards } from "@/components/daily/DailyRewards";
import { useAccount } from "wagmi";
import { parseEther } from "viem";
import {
  Droplets, Hand, Sparkles, RefreshCw, ExternalLink, AlertTriangle,
  Clock, ShieldCheck, Loader2, History, UserPlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useUser } from "@/context/UserContext";
import { useContractActions } from "@/lib/useContractActions";
import {
  GAME_ENABLED, MONAD_FEET_CONTRACT_ADDRESS, MONAD_TREASURY_ADDRESS, MONAD_MAINNET_CHAIN_ID,
} from "@/lib/contract";
import { useGetStreak } from "@workspace/api-client-react";
import {
  useGameState, useGameClaims, useClaimGameTx, useInvalidateGame, usePendingLedger, apiErrorMessage,
  type GameAction,
} from "@/lib/game";

const EXPLORER = "https://monvision.io/tx/";
const ICONS = [Droplets, Hand, Sparkles];
const TINTS = [
  "from-sky-500/15 to-sky-500/0 text-sky-600 dark:text-sky-300",
  "from-amber-500/15 to-amber-500/0 text-amber-600 dark:text-amber-300",
  "from-fuchsia-500/15 to-fuchsia-500/0 text-fuchsia-600 dark:text-fuchsia-300",
];
const HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const short = (h: string) => `${h.slice(0, 8)}…${h.slice(-6)}`;
const eq = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

function useCountdown(target?: string | number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const end = target ? new Date(typeof target === "number" && target < 1e12 ? target * 1000 : target).getTime() : NaN;
  const ms = Number.isFinite(end) ? Math.max(0, end - now) : NaN;
  if (!Number.isFinite(ms)) return { label: "--:--:--", ms: NaN };
  const s = Math.floor(ms / 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return { label: `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`, ms };
}

export default function DailyGame() {
  const { user } = useUser();
  const { address, chainId } = useAccount();
  const { toast } = useToast();
  // Only act for the wallet the verified session belongs to.
  const sessionWallet = user && address && eq(user.walletAddress, address) ? address : undefined;
  const activeWalletRef = useRef(sessionWallet);
  activeWalletRef.current = sessionWallet;
  const stillSameWallet = () => !!sessionWallet && eq(activeWalletRef.current, sessionWallet);
  const game = useGameState(sessionWallet);
  const claims = useGameClaims(sessionWallet);
  const { data: appStreak } = useGetStreak();
  const claim = useClaimGameTx();
  const invalidate = useInvalidateGame();
  const { playFeetGameOnChain, registerOnChain } = useContractActions();
  const ledger = usePendingLedger(sessionWallet);

  const [busy, setBusy] = useState<string | null>(null);
  const busyRef = useRef(false);
  const [confirmAction, setConfirmAction] = useState<GameAction | null>(null);
  const [manualHash, setManualHash] = useState("");
  const [syncing, setSyncing] = useState<string | null>(null);

  useEffect(() => {
    setManualHash(""); setConfirmAction(null);
  }, [sessionWallet]);

  const g = game.data;
  const gameStale = game.isError || game.isRefetchError;
  const countdown = useCountdown(g?.nextResetAt);

  // UTC midnight reset: refetch once the countdown crosses zero.
  const resetFired = useRef<string | number | undefined>(undefined);
  useEffect(() => {
    if (g && countdown.ms === 0 && resetFired.current !== g.nextResetAt) {
      resetFired.current = g.nextResetAt;
      invalidate();
    }
  }, [countdown.ms, g, invalidate]);

  const configMismatch = !!g && (!eq(g.contractAddress, MONAD_FEET_CONTRACT_ADDRESS)
    || !eq(g.treasuryAddress, MONAD_TREASURY_ADDRESS) || g.chainId !== MONAD_MAINNET_CHAIN_ID);
  const wrongChain = chainId !== MONAD_MAINNET_CHAIN_ID;
  const writesOpen = GAME_ENABLED && !!sessionWallet && !gameStale && !!g?.enabled && !configMismatch && !!g?.registered;
  const canRegister = !!sessionWallet && !gameStale && !configMismatch && !wrongChain && !!user?.username;
  const unclaimed = ledger.items;

  async function syncHash(hash: string, receiptSeen = ledger.items.find((p) => eq(p.txHash, hash))?.status === "confirmed") {
    if (!stillSameWallet()) return false;
    setSyncing(hash);
    try {
      const res = await claim.mutateAsync({ data: { txHash: hash } });
      ledger.remove(hash);
      if (!stillSameWallet()) return true;
      toast({
        title: res.alreadyClaimed ? "Already credited" : "Rewards credited",
        description: res.alreadyClaimed
          ? "This transaction was credited earlier."
          : `+${res.pointsAwarded} points${res.invitesAwarded ? `, ${res.invitesAwarded} invite code${res.invitesAwarded > 1 ? "s" : ""}` : ""}.`,
      });
      return true;
    } catch (e) {
      const msg = apiErrorMessage(e);
      ledger.patch(hash, { lastError: msg });
      if (!stillSameWallet()) return false;
      toast(receiptSeen
        ? { title: "Receipt confirmed, credit not synced", description: `${msg}. The hash is saved; retry sync without paying again.`, variant: "destructive" }
        : { title: "Could not verify this transaction", description: `${msg}. Nothing was credited.`, variant: "destructive" });
      return false;
    } finally {
      setSyncing(null);
    }
  }

  async function play(action: GameAction) {
    if (busyRef.current || !writesOpen || wrongChain || !stillSameWallet()) return;
    busyRef.current = true;
    setBusy(`play-${action.id}`);
    setConfirmAction(null);
    let submitted: string | null = null;
    try {
      const value = parseEther(action.priceMon);
      const hash = await playFeetGameOnChain(action.id, value, (h) => {
        submitted = h;
        const ok = ledger.upsert({ txHash: h, actionName: action.name, status: "submitted", at: Date.now() });
        if (!ok) toast({ title: "Could not save to browser storage", description: `Write down this hash to recover later: ${h}`, variant: "destructive", duration: 30_000 });
      });
      if (!hash) throw new Error("No transaction hash returned.");
      ledger.patch(hash, { status: "confirmed" });
      if (!stillSameWallet()) return;
      toast({ title: "Confirmed on Monad", description: `${action.name} receipt confirmed. Syncing rewards…` });
      await syncHash(hash, true);
    } catch (e) {
      if (!stillSameWallet()) return;
      const msg = e instanceof Error ? e.message.split("\n")[0] : "Transaction failed";
      toast({
        title: submitted ? "Transaction not confirmed" : "No payment sent",
        description: submitted ? `${msg}. Hash ${short(submitted)} kept for recovery.` : msg,
        variant: "destructive",
      });
    } finally {
      busyRef.current = false;
      setBusy(null);
      game.refetch();
    }
  }

  async function register() {
    if (busyRef.current || !user?.username || !canRegister) return;
    busyRef.current = true;
    setBusy("register");
    try {
      await registerOnChain(user.username, "");
      if (!stillSameWallet()) return;
      toast({ title: "Registered on the new contract", description: "Receipt confirmed on Monad." });
      invalidate();
    } catch (e) {
      if (!stillSameWallet()) return;
      toast({ title: "Registration failed", description: e instanceof Error ? e.message.split("\n")[0] : "Unknown error", variant: "destructive" });
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  async function submitManual() {
    if (!stillSameWallet()) return;
    const h = manualHash.trim();
    if (!HASH_RE.test(h)) {
      toast({ title: "Invalid hash", description: "Paste a 0x-prefixed 64-character transaction hash.", variant: "destructive" });
      return;
    }
    ledger.upsert({ txHash: h, actionName: "Manual recovery", status: "submitted", at: Date.now() });
    if (await syncHash(h, false)) setManualHash("");
  }

  return (
    <div className="space-y-6" data-testid="page-daily">
      <header className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-primary/10 via-card to-card p-6">
        <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-primary/10 blur-2xl" aria-hidden />
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Your daily rewards</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">Check in. Earn points. Grow together.</h1>
        <p className="mt-2 max-w-xl text-sm text-muted-foreground">
          A little activity goes a long way. Check in, join us on X, and collect points and invite codes
          to bring your friends along. Enjoy free community rewards, or choose a spa treatment for an extra points boost.
        </p>
        <p className="mt-2 max-w-xl text-xs text-muted-foreground">
          Your points are intended for future $MFEET conversion. Timing and rates are not set.
          On-chain check-ins require network gas; optional treatments show their MON price before you pay.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3 text-xs">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-background/70 px-3 py-1 font-mono" data-testid="text-reset-countdown">
            <Clock className="h-3.5 w-3.5" /> Resets in {countdown.label}
          </span>
          {g && <span className="font-mono text-muted-foreground" data-testid="text-utc-day">UTC day {g.utcDay}</span>}
          {game.isFetching && !game.isLoading && (
            <span className="inline-flex items-center gap-1 text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> refreshing</span>
          )}
        </div>
      </header>

      <DailyRewards>
      <div className="space-y-6" id="daily-spa">
      <div>
        <h2 className="text-xl font-semibold">Your daily foot spa</h2>
        <p className="mt-1 text-sm text-muted-foreground">Optional treatments earn points and an invite code every five lifetime treatments. Treatment limits reset at 00:00 UTC.</p>
      </div>
      {!GAME_ENABLED && (
        <Notice tone="amber" testId="notice-game-paused">
          Game payments are paused. You can browse progress and recover earlier transactions.
        </Notice>
      )}
      <details className="rounded-xl border border-border p-4 text-xs text-muted-foreground" data-testid="notice-disclosure">
        <summary className="cursor-pointer font-medium">Treatment costs and contract details</summary>
        <p className="mt-2">This is an early, unaudited deployment. Each treatment has the listed MON price plus network gas.
          Treatment fees go 100% to the platform treasury <span className="font-mono">{short(MONAD_TREASURY_ADDRESS)}</span>.
          Review the amount in the confirmation before opening your wallet.</p>
      </details>

      {ledger.storageError && (
        <Notice tone="red" testId="notice-storage-error">
          Browser storage failed ({ledger.storageError}). Pending hashes below live only in this tab. Copy them now:
          {ledger.items.map((p) => <span key={p.txHash} className="mt-1 block break-all font-mono text-xs">{p.txHash}</span>)}
        </Notice>
      )}

      {!sessionWallet ? (
        <Notice tone="red" testId="notice-wallet-mismatch">
          Connected wallet does not match your signed-in account. Switch back or sign in again.
        </Notice>
      ) : game.isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-24 w-full rounded-2xl" />
          <div className="grid gap-4 md:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-56 rounded-2xl" />)}</div>
        </div>
      ) : game.isError && !g ? (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6 text-center" data-testid="status-game-error">
          <AlertTriangle className="mx-auto h-6 w-6 text-destructive" />
          <p className="mt-2 font-medium">Could not load the game</p>
          <p className="text-sm text-muted-foreground">{apiErrorMessage(game.error)}</p>
          <Button className="mt-4" variant="outline" onClick={() => game.refetch()} data-testid="button-retry-game">
            <RefreshCw className="mr-2 h-4 w-4" /> Retry
          </Button>
        </div>
      ) : g ? (
        <>
          {gameStale && (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive" data-testid="notice-stale">
              <span>Live game state could not refresh. Purchases are disabled until it does.</span>
              <Button size="sm" variant="outline" onClick={() => game.refetch()} data-testid="button-retry-stale">Retry</Button>
            </div>
          )}
          {configMismatch && (
            <Notice tone="red" testId="notice-config-mismatch">
              Server configuration does not match this app's contract, treasury, or chain. Payments are blocked.
            </Notice>
          )}
          {!g.enabled && g.disabledReason && (
            <Notice tone="amber" testId="notice-disabled-reason">{g.disabledReason}</Notice>
          )}

          {!g.registered && (
            <section className="rounded-2xl border border-primary/30 bg-primary/5 p-5" data-testid="section-register">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="flex items-center gap-2 font-semibold"><UserPlus className="h-4 w-4" /> Register on new contract</h2>
                  <p className="mt-1 max-w-lg text-sm text-muted-foreground">
                    Your account exists in the app but not on the new deployment. This signs <span className="font-mono">registerUser("{user?.username ?? "?"}")</span>{" "}
                    on the new contract only. It does not migrate posts, likes, or subscriptions from the previous contract.
                  </p>
                </div>
                <Button onClick={register} disabled={!!busy || !canRegister} data-testid="button-register-new-contract">
                  {busy === "register" ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Confirming…</> : "Register on new contract"}
                </Button>
              </div>
              {wrongChain && <p className="mt-2 text-xs text-destructive">Switch your wallet to Monad Mainnet first.</p>}
              {configMismatch && <p className="mt-2 text-xs text-destructive">Blocked: server contract configuration does not match this app.</p>}
            </section>
          )}

          <section className="grid grid-cols-2 gap-3 md:grid-cols-5" data-testid="section-stats">
            <Stat label="Contract points" value={String(g.onChainPoints)} sub="on-chain balance" testId="text-onchain-points" />
            <Stat label="App points" value={appStreak ? String(appStreak.totalPoints) : "-"} sub="separate balance" testId="text-app-points" />
            <Stat label="Treatments today" value={String(g.actions.reduce((s, a) => s + a.count, 0))} testId="text-today-count" />
            <Stat label="Lifetime treatments" value={String(g.totalPurchases)} testId="text-total-purchases" />
            <Stat label="Check-in streak" value={`${g.currentStreak}d`} sub={`best ${g.longestStreak}d`} testId="text-streak" />
          </section>

          <section className="grid gap-4 md:grid-cols-3" data-testid="section-actions">
            {g.actions.map((a, i) => {
              const Icon = ICONS[i] ?? Sparkles;
              const soldOut = a.remaining <= 0;
              const isBusy = busy === `play-${a.id}`;
              return (
                <article key={a.id} className="flex flex-col rounded-2xl border border-border bg-card p-5" data-testid={`card-action-${a.id}`}>
                  <div className={`mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br ${TINTS[i] ?? TINTS[0]}`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="text-lg font-semibold">{a.name}</h3>
                  <p className="font-mono text-2xl font-bold" data-testid={`text-price-${a.id}`}>{a.priceMon} <span className="text-sm text-muted-foreground">MON</span></p>
                  <dl className="mt-3 space-y-1 text-sm">
                    <Row k="Next reward" v={`${a.nextPoints} pts`} />
                    <Row k="Base" v={`${a.basePoints} pts, doubles each buy`} />
                    <Row k="Today" v={`${a.count} / ${a.count + a.remaining}`} />
                  </dl>
                  <div className="mt-2 flex gap-0.5" aria-hidden>
                    {Array.from({ length: a.count + a.remaining }).map((_, k) => (
                      <span key={k} className={`h-1.5 flex-1 rounded-full ${k < a.count ? "bg-primary" : "bg-muted"}`} />
                    ))}
                  </div>
                  <div className="mt-auto pt-4">
                    {confirmAction?.id === a.id ? (
                      <div className="space-y-2 rounded-xl border border-border bg-muted/40 p-3 text-xs" data-testid={`confirm-action-${a.id}`}>
                        <p>You pay exactly <b className="font-mono">{a.priceMon} MON</b> plus gas. 100% of the treatment fee goes to treasury <span className="font-mono">{short(MONAD_TREASURY_ADDRESS)}</span>. This contract is unaudited.</p>
                        <div className="flex gap-2">
                          <Button size="sm" className="flex-1" onClick={() => play(a)} disabled={!!busy} data-testid={`button-confirm-play-${a.id}`}>Open wallet</Button>
                          <Button size="sm" variant="ghost" onClick={() => setConfirmAction(null)} data-testid={`button-cancel-play-${a.id}`}>Cancel</Button>
                        </div>
                      </div>
                    ) : (
                      <Button
                        className="w-full"
                        disabled={!writesOpen || soldOut || !!busy || wrongChain}
                        onClick={() => setConfirmAction(a)}
                        data-testid={`button-play-${a.id}`}
                      >
                        {isBusy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Waiting for receipt…</>
                          : soldOut ? "Done for today"
                          : !GAME_ENABLED ? "Paused"
                          : `Book for ${a.priceMon} MON`}
                      </Button>
                    )}
                  </div>
                </article>
              );
            })}
          </section>

          <p className="text-sm text-muted-foreground" data-testid="section-invite-progress">
            {g.purchasesUntilInvite} more treatment{g.purchasesUntilInvite === 1 ? "" : "s"} until your next invite code.
            Earned codes appear in Invite Codes below.
          </p>
        </>
      ) : null}

      <section className="rounded-2xl border border-border bg-card p-5" data-testid="section-recovery">
        <h2 className="flex items-center gap-2 font-semibold"><ShieldCheck className="h-4 w-4" /> Unsynced spa payments</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Transactions saved in this browser for this wallet and contract. Sync credits them without paying again.
          The server verifies each receipt on chain before awarding anything. For check-in recovery, use Daily Streak above.
        </p>
        {unclaimed.length === 0 ? (
          <p className="mt-3 rounded-lg bg-muted/40 px-3 py-3 text-sm text-muted-foreground" data-testid="text-no-pending">Nothing waiting. Every saved payment has been credited.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {unclaimed.map((p) => (
              <li key={p.txHash} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between" data-testid={`row-pending-${p.txHash}`}>
                <div className="min-w-0">
                  <p className="text-sm font-medium">{p.actionName} <span className="ml-1 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase">{p.status === "confirmed" ? "receipt confirmed" : "awaiting receipt"}</span></p>
                  <a href={EXPLORER + p.txHash} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-xs text-primary hover:underline">
                    {short(p.txHash)} <ExternalLink className="h-3 w-3" />
                  </a>
                  {p.lastError && <p className="text-xs text-destructive">{p.lastError}</p>}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => syncHash(p.txHash)} disabled={syncing !== null} data-testid={`button-sync-${p.txHash}`}>
                    {syncing === p.txHash ? <Loader2 className="h-4 w-4 animate-spin" /> : <><RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Retry sync</>}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => ledger.remove(p.txHash)} disabled={syncing !== null} data-testid={`button-forget-${p.txHash}`}>Forget</Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <Input value={manualHash} onChange={(e) => setManualHash(e.target.value)} placeholder="Lost browser data? Paste a 0x transaction hash" className="font-mono text-xs" data-testid="input-manual-hash" />
          <Button variant="outline" onClick={submitManual} disabled={syncing !== null || !manualHash.trim()} data-testid="button-submit-manual-hash">Recover</Button>
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card p-5" data-testid="section-claims">
        <h2 className="flex items-center gap-2 font-semibold"><History className="h-4 w-4" /> Credited treatments</h2>
        {claims.isLoading ? (
          <div className="mt-3 space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-9" />)}</div>
        ) : claims.isError ? (
          <div className="mt-3 flex items-center justify-between rounded-lg bg-destructive/5 px-3 py-2 text-sm">
            <span>Could not load history.</span>
            <Button size="sm" variant="ghost" onClick={() => claims.refetch()} data-testid="button-retry-claims">Retry</Button>
          </div>
        ) : !claims.data?.claims.length ? (
          <p className="mt-3 text-sm text-muted-foreground" data-testid="text-no-claims">No credited treatments yet. Your first wash is 5 points.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border text-sm">
            {claims.data.claims.map((c) => (
              <li key={c.txHash} className="flex items-center justify-between gap-2 py-2" data-testid={`row-claim-${c.txHash}`}>
                <a href={EXPLORER + c.txHash} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-xs text-primary hover:underline">
                  {short(c.txHash)} <ExternalLink className="h-3 w-3" />
                </a>
                <span className="text-xs text-muted-foreground">{new Date(c.createdAt).toLocaleString()}</span>
                <span className="font-medium">+{c.pointsAwarded} pts{c.invitesAwarded ? ` · ${c.invitesAwarded} invite` : ""}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      </div>
      </DailyRewards>
    </div>
  );
}

function Notice({ tone, children, testId }: { tone: "amber" | "red" | "muted"; children: React.ReactNode; testId: string }) {
  const cls = tone === "amber" ? "border-amber-300/60 bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
    : tone === "red" ? "border-destructive/40 bg-destructive/5 text-destructive"
    : "border-border bg-muted/40 text-muted-foreground";
  return (
    <div className={`flex gap-2 rounded-xl border px-4 py-3 text-sm ${cls}`} data-testid={testId}>
      <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
      <div>{children}</div>
    </div>
  );
}

function Stat({ label, value, sub, testId }: { label: string; value: string; sub?: string; testId: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="font-mono text-xl font-bold" data-testid={testId}>{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="font-medium">{v}</dd>
    </div>
  );
}
