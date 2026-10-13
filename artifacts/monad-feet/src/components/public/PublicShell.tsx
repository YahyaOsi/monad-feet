import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Menu, X, ArrowUpRight } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { PROJECT_SOCIALS, useBetaStatus } from "@/lib/publicSite";
import "./public.css";

export function FootMark({ className = "", rotate = 0 }: { className?: string; rotate?: number }) {
  return (
    <svg className={className} viewBox="0 0 42 62" fill="currentColor" aria-hidden="true" style={{ transform: `rotate(${rotate}deg)` }}>
      <ellipse cx="21" cy="41" rx="11" ry="19" />
      <circle cx="11" cy="11" r="6" />
      <circle cx="24" cy="7" r="5" />
      <circle cx="34" cy="13" r="4" />
      <circle cx="38" cy="23" r="3" />
    </svg>
  );
}

export function Reveal({ children, className = "", delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      el.classList.add("is-in");
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            el.classList.add("is-in");
            io.disconnect();
          }
        });
      },
      { threshold: 0.12 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={`mfp-reveal ${className}`} style={{ animationDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

export function ExternalLink({ href, children, testId, className = "" }: { href: string; children: ReactNode; testId: string; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className} data-testid={testId}>
      {children}
    </a>
  );
}

const NAV = [
  { href: "/", label: "Home", id: "home" },
  { href: "/docs", label: "Docs", id: "docs" },
  { href: "/roadmap", label: "Roadmap", id: "roadmap" },
];

export function PublicShell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [open, setOpen] = useState(false);
  const isBeta = useBetaStatus();

  useEffect(() => {
    setOpen(false);
    if (!window.location.hash) window.scrollTo({ top: 0, behavior: "auto" });
  }, [location]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="mfp">
      <header className="sticky top-0 z-40 border-b mfp-line backdrop-blur" style={{ background: "hsl(var(--mfp-paper) / .85)" }}>
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3 sm:px-8">
          <Link href="/" className="flex items-center gap-2 font-bold tracking-tight" data-testid="link-brand-home">
            <FootMark className="h-6 w-4" rotate={-12} />
            <span>Monad Feet</span>
            {isBeta && (
              <span className="mfp-sun mfp-mono ml-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest" data-testid="badge-beta">Beta</span>
            )}
          </Link>
          <nav className="hidden items-center gap-1 md:flex" aria-label="Primary">
            {NAV.map((n) => (
              <Link key={n.id} href={n.href} className="mfp-navlink" aria-current={location === n.href ? "page" : undefined} data-testid={`link-nav-${n.id}`}>
                {n.label}
              </Link>
            ))}
            <ExternalLink href={PROJECT_SOCIALS.x} testId="link-nav-x" className="mfp-navlink inline-flex items-center gap-1">
              X <ArrowUpRight className="h-3 w-3" />
            </ExternalLink>
          </nav>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <button
              type="button"
              className="inline-flex h-10 w-10 items-center justify-center rounded-full md:hidden"
              aria-label={open ? "Close menu" : "Open menu"}
              aria-expanded={open}
              aria-controls="mfp-mobile-menu"
              onClick={() => setOpen((v) => !v)}
              data-testid="button-mobile-menu"
            >
              {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>
        {open && (
          <nav id="mfp-mobile-menu" className="border-t mfp-line px-5 pb-5 pt-3 md:hidden" aria-label="Mobile">
            <ul className="space-y-1">
              {NAV.map((n) => (
                <li key={n.id}>
                  <Link href={n.href} className="block rounded-xl px-3 py-3 text-xl font-semibold" aria-current={location === n.href ? "page" : undefined} data-testid={`link-mobile-${n.id}`}>
                    {n.label}
                  </Link>
                </li>
              ))}
              <li>
                <ExternalLink href={PROJECT_SOCIALS.x} testId="link-mobile-x" className="block rounded-xl px-3 py-3 text-xl font-semibold">X</ExternalLink>
              </li>
              <li>
                <ExternalLink href={PROJECT_SOCIALS.telegram} testId="link-mobile-telegram" className="block rounded-xl px-3 py-3 text-xl font-semibold">Telegram</ExternalLink>
              </li>
            </ul>
          </nav>
        )}
      </header>
      <main>{children}</main>
      <footer className="border-t mfp-line">
        <div className="mx-auto grid max-w-6xl gap-8 px-5 py-12 sm:px-8 md:grid-cols-[1.5fr_1fr_1fr]">
          <div>
            <p className="mfp-display text-4xl">Monad Feet</p>
            <p className="mfp-muted mt-3 max-w-xs text-sm">A social and creator community on Monad Mainnet.</p>
          </div>
          <div>
            <p className="mfp-mono text-xs uppercase tracking-widest mfp-muted">Read</p>
            <ul className="mt-3 space-y-2 text-sm">
              <li><Link href="/docs" data-testid="link-footer-docs">Documentation</Link></li>
              <li><Link href="/roadmap" data-testid="link-footer-roadmap">Roadmap</Link></li>
              <li><Link href="/" data-testid="link-footer-home">Home</Link></li>
            </ul>
          </div>
          <div>
            <p className="mfp-mono text-xs uppercase tracking-widest mfp-muted">Follow</p>
            <ul className="mt-3 space-y-2 text-sm">
              <li><ExternalLink href={PROJECT_SOCIALS.x} testId="link-footer-x">X, @MonadFeet</ExternalLink></li>
              <li><ExternalLink href={PROJECT_SOCIALS.telegram} testId="link-footer-telegram">Telegram, @MonadFeet</ExternalLink></li>
            </ul>
          </div>
        </div>
      </footer>
    </div>
  );
}
