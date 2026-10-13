import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { PublicShell, Reveal, ExternalLink } from "@/components/public/PublicShell";
import { ROADMAP } from "@/content/publicContent";
import { usePageMetadata } from "@/hooks/usePageMetadata";
import { PROJECT_SOCIALS } from "@/lib/publicSite";

export default function Roadmap() {
  usePageMetadata(
    "Monad Feet roadmap",
    "What Monad Feet has shipped, what is live now and what is planned next.",
  );
  return (
    <PublicShell>
      <div className="mx-auto max-w-6xl px-5 py-14 sm:px-8">
        <p className="mfp-mono text-xs uppercase tracking-[0.25em] mfp-muted">Roadmap</p>
        <h1 className="mfp-display mt-4 text-[clamp(3rem,9vw,7rem)]" data-testid="text-roadmap-title">Where we have been and where we are going</h1>
        <p className="mfp-muted mt-6 max-w-xl text-lg">
          Explore the project history, the live app and the next planned releases. Future dates are targets and may change as development progresses.
        </p>

        <ol className="relative mt-16 space-y-6 border-l-2 pl-6 sm:pl-10" style={{ borderColor: "hsl(var(--mfp-violet) / .4)" }}>
          {ROADMAP.map((r) => (
            <li key={r.id} className="relative" id={r.id}>
              <span
                className="absolute -left-[2.2rem] top-8 h-4 w-4 rounded-full border-2 sm:-left-[3.2rem]"
                style={{
                  borderColor: "hsl(var(--mfp-violet))",
                  background: r.status === "Planned" ? "hsl(var(--mfp-paper))" : "hsl(var(--mfp-violet))",
                }}
                aria-hidden
              />
              <Reveal>
                <article className="mfp-panel p-6 sm:p-8" data-testid={`card-roadmap-${r.id}`}>
                  <div className="flex flex-wrap items-center gap-3">
                    <span
                      className={`mfp-mono rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-widest ${r.status === "Current" ? "mfp-sun" : r.status === "Completed" ? "mfp-violet" : ""}`}
                      style={r.status === "Planned" ? { border: "1px solid hsl(var(--mfp-ink) / .3)" } : undefined}
                      data-testid={`status-roadmap-${r.id}`}
                    >
                      {r.status}
                    </span>
                    <span className="mfp-mono text-sm mfp-muted">{r.when}</span>
                  </div>
                  <h2 className="mfp-display mt-4 text-3xl sm:text-5xl" style={{ lineHeight: 0.95 }}>{r.title}</h2>
                  <ul className="mfp-muted mt-5 max-w-2xl space-y-3 text-lg leading-relaxed">
                    {r.points.map((p, i) => <li key={i}>{p}</li>)}
                  </ul>
                </article>
              </Reveal>
            </li>
          ))}
        </ol>

        <div className="mfp-panel mt-16 flex flex-wrap items-center justify-between gap-4 p-7">
          <p className="max-w-md">Points have no fixed cash value and no token exchange rate. Read how the app works in the docs, or follow updates on X.</p>
          <div className="flex flex-wrap gap-3">
            <Link href="/docs" className="mfp-btn" data-testid="link-roadmap-docs">Docs <ArrowRight className="h-4 w-4" /></Link>
            <ExternalLink href={PROJECT_SOCIALS.x} testId="link-roadmap-x" className="mfp-btn mfp-violet">Follow on X</ExternalLink>
          </div>
        </div>
      </div>
    </PublicShell>
  );
}
