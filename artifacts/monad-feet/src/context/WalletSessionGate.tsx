import type { ReactNode } from "react";
import { useAccount, useDisconnect } from "wagmi";
import { useUser } from "./UserContext";

export function WalletSessionGate({ children, profileError }: { children: ReactNode; profileError?: string }) {
  const { address, status } = useAccount();
  const { disconnect } = useDisconnect();
  const { session, signIn, retrySession, logout } = useUser();

  if (status === "connecting" || status === "reconnecting" || (address && session.address?.toLowerCase() !== address.toLowerCase())
    || (address && (session.phase === "checking" || session.phase === "signing"))) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-background text-foreground" role="status">
        {session.phase === "signing" ? "Waiting for wallet signature…" : "Checking wallet session…"}
      </div>
    );
  }
  if (status !== "connected" || !address) {
    if (session.phase === "error") {
      return (
        <main className="flex min-h-[100dvh] items-center justify-center bg-background p-6 text-foreground">
          <section className="max-w-md space-y-4 rounded-2xl border border-border bg-card p-8">
            <h1 className="text-xl font-bold">Could not clear wallet session</h1>
            <p role="alert" className="text-sm text-destructive">{session.error}</p>
            <button type="button" onClick={retrySession} className="rounded-lg bg-primary px-4 py-2 text-primary-foreground">Retry session cleanup</button>
          </section>
        </main>
      );
    }
    return <>{children}</>;
  }
  if (session.phase === "verified" && !profileError) return <>{children}</>;

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-background p-6 text-foreground">
      <section className="w-full max-w-md space-y-5 rounded-2xl border border-border bg-card p-8 shadow-lg">
        <h1 className="text-2xl font-bold">Sign in with your wallet</h1>
        <p className="text-sm text-muted-foreground">
          Connected as {address.slice(0, 6)}…{address.slice(-4)}. Sign a message to access your account. No transaction or gas is required.
        </p>
        {(session.error || profileError) && (
          <p role="alert" className="rounded-lg border border-destructive p-3 text-sm text-destructive">
            {session.error || `Profile lookup failed: ${profileError}. Please retry; onboarding is unavailable until the server responds.`}
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          {session.phase === "verified"
            ? <button type="button" onClick={retrySession} className="rounded-lg bg-primary px-4 py-2 text-primary-foreground">Retry</button>
            : <>
              <button type="button" onClick={() => void signIn()} className="rounded-lg bg-primary px-4 py-2 text-primary-foreground">
                {session.phase === "error" ? "Retry sign in" : "Sign in"}
              </button>
              {session.phase === "error" && <button type="button" onClick={retrySession} className="rounded-lg border border-border px-4 py-2">Retry session check</button>}
            </>}
          <button type="button" onClick={logout} className="rounded-lg border border-border px-4 py-2">Log out</button>
          <button type="button" onClick={() => disconnect()} className="rounded-lg border border-border px-4 py-2">Use a different wallet</button>
        </div>
      </section>
    </main>
  );
}