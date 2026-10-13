import { useUser } from "@/context/UserContext";
import { useAccount } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { Link, Redirect } from "wouter";
import { Wallet, ArrowRight, Camera, Coins, Flame, Users, KeyRound, CalendarClock } from "lucide-react";
import { MonadLoading } from "@/components/MonadLoading";
import { FootMark, PublicShell, Reveal, ExternalLink } from "@/components/public/PublicShell";
import { TREATMENTS } from "@/content/publicContent";
import { usePageMetadata } from "@/hooks/usePageMetadata";
import { PROJECT_SOCIALS, useBetaStatus } from "@/lib/publicSite";
import { onboardingPath, postLoginPath } from "@/lib/shareNavigation";

const TICKER = ["Photo posts", "Monthly MON subscriptions", "Private Feed", "Daily streaks", "Foot spa rewards", "Weekly stats", "Leaderboards", "Wallet identity"];

const FEATURES = [
  { icon: Camera, title: "Post photos", desc: "Share photos with captions and a public link. Keep some posts public and some for subscribers." },
  { icon: Coins, title: "Subscribe in MON", desc: "Creators set a monthly price. Each subscription lasts 30 days." },
  { icon: Flame, title: "Show up daily", desc: "Check in, build a streak and collect points and milestone rewards." },
  { icon: Users, title: "Find your people", desc: "Search, trending posts, replies and online presence keep the feed lively." },
];

export default function Landing() {
  const { isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { user, isLoading } = useUser();
  const isBeta = useBetaStatus();
  const returnTo = postLoginPath(window.location.search);
  usePageMetadata(
    "Monad Feet, social and creator community on Monad",
    "Share photos, subscribe to creators in MON and play the foot spa rewards game on Monad Mainnet.",
  );

  if (isLoading) return <MonadLoading />;
  if (isConnected && user) return <Redirect to={returnTo ?? "/feed"} />;
  if (isConnected && !user) return <Redirect to={onboardingPath(returnTo)} />;

  const connect = (testId: string) => (
    <button
      type="button"
      className="mfp-btn mfp-violet"
      onClick={() => openConnectModal?.()}
      disabled={!openConnectModal}
      data-testid={testId}
    >
      <Wallet className="h-4 w-4" /> Connect wallet
    </button>
  );

  return (
    <PublicShell>
      <section className="relative isolate overflow-hidden">
        <div className="mfp-orb -left-24 top-0 h-96 w-96" style={{ background: "hsl(var(--mfp-violet) / .5)" }} aria-hidden />
        <div className="mfp-orb right-0 top-40 h-80 w-80" style={{ background: "hsl(var(--mfp-sun) / .5)", animationDelay: "-6s" }} aria-hidden />
        <div className="relative mx-auto grid max-w-6xl gap-10 px-5 pb-20 pt-14 sm:px-8 sm:pt-24 lg:grid-cols-[1.4fr_1fr] lg:items-center">
          <div>
            <p className="mfp-mono text-xs uppercase tracking-[0.25em] mfp-muted">
              {isBeta ? "Beta on Monad Mainnet" : "On Monad Mainnet"}
            </p>
            <h1 className="mfp-display mt-5 text-[clamp(4rem,15vw,10.5rem)]" data-testid="text-hero-title">
              Monad
              <br />
              <span style={{ color: "hsl(var(--mfp-violet))" }}>Feet</span>
            </h1>
            <p className="mt-8 max-w-lg text-lg mfp-muted" data-testid="text-welcome">
              A social and creator community where your wallet is your profile. Share photos, support creators with MON subscriptions and earn points through daily activities.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              {connect("button-connect-wallet")}
              <Link href="/docs" className="mfp-btn" data-testid="link-hero-docs">
                Read the docs <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
            <p className="mt-4 text-sm mfp-muted">Already a member? Connect to sign in.</p>
          </div>

          <div className="relative mx-auto flex aspect-square w-full max-w-sm items-center justify-center" aria-hidden>
            <span className="mfp-ripple inset-0" />
            <span className="mfp-ripple inset-0" style={{ animationDelay: "-3s" }} />
            <div className="mfp-violet absolute inset-8 rounded-full opacity-95" />
            <FootMark className="mfp-step absolute left-[24%] top-[22%] h-40 w-28 text-[hsl(var(--mfp-sun))]" />
            <FootMark className="mfp-step absolute right-[22%] top-[32%] h-40 w-28 text-[hsl(var(--mfp-paper))]" />
            <style>{`.mfp-step:nth-of-type(1){--r:-14deg}.mfp-step:nth-of-type(2){--r:12deg;animation-delay:-2.5s}`}</style>
          </div>
        </div>
      </section>

      <div className="overflow-hidden border-y mfp-line py-4 mfp-sun" aria-hidden>
        <div className="mfp-marquee">
          {[...TICKER, ...TICKER].map((t, i) => (
            <span key={i} className="mfp-display mx-6 whitespace-nowrap text-2xl" style={{ letterSpacing: "-0.02em" }}>
              {t}
              <FootMark className="ml-6 inline-block h-5 w-3" rotate={20} />
            </span>
          ))}
        </div>
      </div>

      <section className="mx-auto max-w-6xl px-5 py-24 sm:px-8" aria-labelledby="features-heading">
        <Reveal>
          <h2 id="features-heading" className="mfp-display max-w-3xl text-[clamp(2.4rem,6vw,4.5rem)]">
            Where creators and community connect.
          </h2>
        </Reveal>
        <div className="mt-12 grid gap-4 md:grid-cols-6">
          {FEATURES.map((f, i) => (
            <Reveal key={f.title} delay={i * 90} className={i === 0 ? "md:col-span-4" : i === 3 ? "md:col-span-4 md:col-start-3" : "md:col-span-2"}>
              <div className="mfp-panel h-full p-7" data-testid={`card-feature-${i}`}>
                <f.icon className="h-6 w-6" style={{ color: "hsl(var(--mfp-violet))" }} aria-hidden />
                <h3 className="mt-6 text-2xl font-bold tracking-tight">{f.title}</h3>
                <p className="mfp-muted mt-2 max-w-md">{f.desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="border-y mfp-line" style={{ background: "hsl(var(--mfp-paper2))" }} aria-labelledby="spa-heading">
        <div className="mx-auto max-w-6xl px-5 py-24 sm:px-8">
          <Reveal>
            <p className="mfp-mono text-xs uppercase tracking-[0.25em] mfp-muted">The foot spa</p>
            <h2 id="spa-heading" className="mfp-display mt-4 max-w-3xl text-[clamp(2.4rem,6vw,4.5rem)]">
              Three treatments. One daily ritual.
            </h2>
            <p className="mfp-muted mt-5 max-w-xl">
              Pick a treatment, pay in MON and collect points. Each treatment can be bought up to 10 times per UTC day, and each purchase is its own transaction. Points have no cash value.
            </p>
          </Reveal>
          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {TREATMENTS.map((t, i) => (
              <Reveal key={t.name} delay={i * 100}>
                <article className="mfp-panel flex h-full flex-col p-7" data-testid={`card-treatment-${t.name.toLowerCase()}`}>
                  <p className="mfp-mono text-sm mfp-muted">{t.price}</p>
                  <h3 className="mfp-display mt-3 text-5xl">{t.name}</h3>
                  <p className="mt-6 text-sm mfp-muted">Rewarded purchases</p>
                  <p className="mfp-mono text-sm">{t.doubles}</p>
                  <p className="mt-6 text-sm mfp-muted">Total points per day</p>
                  <p className="mfp-display text-5xl" style={{ color: "hsl(var(--mfp-violet))" }}>{t.total}</p>
                  <p className="mt-auto pt-6 text-sm mfp-muted">{t.invite}</p>
                </article>
              </Reveal>
            ))}
          </div>
          <Link href="/docs#foot-spa" className="mt-8 inline-flex items-center gap-2 font-semibold underline underline-offset-4" data-testid="link-spa-docs">
            Full reward details <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-24 sm:px-8" aria-labelledby="access-heading">
        <Reveal>
          <h2 id="access-heading" className="mfp-display text-[clamp(2.4rem,6vw,4.5rem)]">How to get in</h2>
        </Reveal>
        <div className="mt-10 grid gap-4 md:grid-cols-2">
          <Reveal>
            <div className="mfp-panel h-full p-7" data-testid="card-access-invite">
              <KeyRound className="h-6 w-6" style={{ color: "hsl(var(--mfp-violet))" }} aria-hidden />
              <h3 className="mt-5 text-2xl font-bold">Invite code <span className="mfp-sun mfp-mono ml-2 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-widest">Open now</span></h3>
              <p className="mfp-muted mt-2">Connect your wallet and enter an invite code from a member or the Monad Feet team.</p>
              <div className="mt-6">{connect("button-connect-access-wallet")}</div>
            </div>
          </Reveal>
          <Reveal delay={100}>
            <div className="mfp-panel h-full p-7" data-testid="card-access-nft">
              <CalendarClock className="h-6 w-6" style={{ color: "hsl(var(--mfp-violet))" }} aria-hidden />
              <h3 className="mt-5 text-2xl font-bold">CHOG NFT access <span className="mfp-mono mfp-muted ml-2 text-[10px] uppercase tracking-widest">Open now</span></h3>
              <p className="mfp-muted mt-2">
                Hold a CHOG Genesis NFT in your wallet to join without an invite after an ownership check and signed registration. Current holders receive the ChogNFT holder badge. Monad Feet NFT access is not available yet; its mint is coming soon.
              </p>
              <Link href="/roadmap" className="mt-6 inline-flex items-center gap-2 font-semibold underline underline-offset-4" data-testid="link-access-roadmap">
                See the roadmap <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 pb-24 sm:px-8">
        <Reveal>
          <div className="mfp-violet rounded-[2rem] p-8 sm:p-14">
            <h2 className="mfp-display text-[clamp(2.4rem,6vw,4.5rem)]">Follow along.</h2>
            <p className="mt-4 max-w-md opacity-90">Updates and community conversation happen on X and Telegram.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ExternalLink href={PROJECT_SOCIALS.x} testId="link-cta-x" className="mfp-btn mfp-sun">X, @MonadFeet</ExternalLink>
              <ExternalLink href={PROJECT_SOCIALS.telegram} testId="link-cta-telegram" className="mfp-btn" >Telegram</ExternalLink>
            </div>
          </div>
        </Reveal>
      </section>
    </PublicShell>
  );
}
