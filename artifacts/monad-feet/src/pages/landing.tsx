import { useUser } from "@/context/UserContext";
import { useAccount } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { Redirect } from "wouter";
import { Wallet, KeyRound, Image as ImageIcon, Coins, Flame, CalendarClock, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";
import { onboardingPath, postLoginPath } from "@/lib/shareNavigation";

const FEATURES = [
  {
    icon: ImageIcon,
    title: "Image posts",
    desc: "Share photos with the community. Keep some public and some for subscribers only.",
  },
  {
    icon: Coins,
    title: "Earn $MON",
    desc: "Creators set a monthly price and earn $MON through subscriptions.",
  },
  {
    icon: Flame,
    title: "Daily streaks",
    desc: "Check in each day to build a streak and collect points.",
  },
  {
    icon: Users,
    title: "Invite only",
    desc: "A small, trusted group. Every member was let in by someone.",
  },
];

export default function Landing() {
  const { isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { user, isLoading } = useUser();
  const returnTo = postLoginPath(window.location.search);

  if (isLoading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center" role="status" aria-label="Loading">
        <div className="h-10 w-10 rounded-full bg-primary/20 animate-pulse" />
      </div>
    );
  }
  if (isConnected && user) return <Redirect to={returnTo ?? "/feed"} />;
  if (isConnected && !user) return <Redirect to={onboardingPath(returnTo)} />;

  return (
    <div className="mf-grain relative min-h-[100dvh] flex flex-col bg-background text-foreground overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -left-32 w-[520px] h-[520px] rounded-full bg-primary/15 blur-[120px]" />
        <div className="absolute top-1/3 -right-40 w-[460px] h-[460px] rounded-full bg-amber-400/15 blur-[120px]" />
      </div>

      <header className="relative z-10 flex items-center justify-between px-5 sm:px-8 py-5">
        <span className="font-bold tracking-tight text-lg text-primary">Monad Feet</span>
        <div className="flex items-center gap-3">
          <span className="hidden sm:inline text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Beta</span>
          <ThemeToggle />
        </div>
      </header>

      <main className="relative z-10 flex-1 w-full max-w-5xl mx-auto px-5 sm:px-8 pb-16">
        <section className="pt-10 sm:pt-20 grid gap-10 lg:grid-cols-[1.3fr_1fr] lg:items-end">
          <div className="mf-rise">
            <p className="inline-flex items-center gap-2 rounded-full border border-border bg-card/70 px-3 py-1 text-xs font-medium text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> Beta version
            </p>
            <h1 className="mt-6 text-[clamp(3.5rem,12vw,8rem)] font-extrabold leading-[0.88] tracking-[-0.04em]">
              Monad
              <br />
              <span className="text-primary">Feet</span>
            </h1>
            <p className="mt-6 max-w-md text-lg text-muted-foreground" data-testid="text-welcome">
              Welcome to the beta version. Connect the wallet holding your NFT, or get an invite code to enter.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row gap-3 sm:items-center">
              <Button
                size="lg"
                className="h-12 px-6 rounded-full text-base gap-2"
                onClick={() => openConnectModal?.()}
                disabled={!openConnectModal}
                data-testid="button-connect-wallet"
              >
                <Wallet className="h-4 w-4" /> Connect wallet
              </Button>
              <p className="text-sm text-muted-foreground">Already a member? Connect to sign in.</p>
            </div>
          </div>

          <aside
            className="mf-rise rounded-3xl border border-border bg-card/80 backdrop-blur p-6 space-y-5"
            style={{ animationDelay: "120ms" }}
            aria-labelledby="access-heading"
          >
            <h2 id="access-heading" className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              How to get in
            </h2>
            <div className="flex gap-4">
              <div className="h-10 w-10 shrink-0 rounded-xl bg-primary/15 text-primary flex items-center justify-center">
                <KeyRound className="h-5 w-5" />
              </div>
              <div>
                <p className="font-semibold">Invite code <span className="ml-1 text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">Open now</span></p>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Right now the only way in is an invite code from the Monad Feet team.
                </p>
              </div>
            </div>
            <div className="flex gap-4">
              <div className="h-10 w-10 shrink-0 rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center">
                <CalendarClock className="h-5 w-5" />
              </div>
              <div>
                <p className="font-semibold">NFT access <span className="ml-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Planned</span></p>
                <p className="text-sm text-muted-foreground mt-0.5">
                  NFT holder access is planned for 10 October 2026. The contract and purchase link are not available yet.
                </p>
              </div>
            </div>
          </aside>
        </section>

        <section aria-labelledby="features-heading" className="mt-20 sm:mt-28">
          <h2 id="features-heading" className="text-2xl sm:text-3xl font-bold tracking-tight max-w-md">
            A small place to post, subscribe and show up daily.
          </h2>
          <div className="mt-8 grid gap-px overflow-hidden rounded-3xl border border-border bg-border sm:grid-cols-2">
            {FEATURES.map((f) => (
              <div key={f.title} className="bg-card p-6 sm:p-8">
                <f.icon className="h-5 w-5 text-primary" aria-hidden />
                <h3 className="mt-4 font-semibold text-lg">{f.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-border px-5 sm:px-8 py-6 text-sm text-muted-foreground flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
        <span>Built for the Monad community.</span>
        <span className="text-xs">Monad Feet beta</span>
      </footer>
    </div>
  );
}
