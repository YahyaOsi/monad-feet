import { useEffect, useState } from "react";
import { PublicShell } from "@/components/public/PublicShell";
import { DOC_SECTIONS, TREATMENTS } from "@/content/publicContent";
import { usePageMetadata } from "@/hooks/usePageMetadata";

export default function Docs() {
  const [active, setActive] = useState(DOC_SECTIONS[0].id);
  usePageMetadata(
    "Monad Feet documentation",
    "How Monad Feet works: wallet profiles, photo posts, subscriptions, check ins, points and the foot spa.",
  );

  useEffect(() => {
    if (window.location.hash) {
      const el = document.getElementById(window.location.hash.slice(1));
      el?.scrollIntoView();
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => e.isIntersecting && setActive(e.target.id));
      },
      { rootMargin: "-20% 0px -70% 0px" },
    );
    DOC_SECTIONS.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el) io.observe(el);
    });
    return () => io.disconnect();
  }, []);

  return (
    <PublicShell>
      <div className="mx-auto max-w-6xl px-5 py-14 sm:px-8">
        <p className="mfp-mono text-xs uppercase tracking-[0.25em] mfp-muted">Documentation</p>
        <h1 className="mfp-display mt-4 text-[clamp(3rem,9vw,7rem)]" data-testid="text-docs-title">How Monad Feet works</h1>
        <div className="mt-14 grid grid-cols-1 gap-12 lg:grid-cols-[220px_1fr]">
          <nav aria-label="Documentation sections" className="min-w-0 lg:sticky lg:top-24 lg:max-h-[calc(100dvh-7rem)] lg:overflow-y-auto lg:self-start">
            <ul className="flex gap-1 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible">
              {DOC_SECTIONS.map((s) => (
                <li key={s.id} className="shrink-0">
                  <a
                    href={`#${s.id}`}
                    className="mfp-navlink block whitespace-nowrap"
                    aria-current={active === s.id ? "page" : undefined}
                    data-testid={`link-toc-${s.id}`}
                  >
                    {s.title}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <div className="min-w-0 space-y-16">
            {DOC_SECTIONS.map((s) => (
              <section key={s.id} id={s.id} className="scroll-mt-24" aria-labelledby={`h-${s.id}`}>
                <h2 id={`h-${s.id}`} className="mfp-display text-4xl sm:text-5xl">{s.title}</h2>
                <div className="mt-5 max-w-2xl space-y-4 text-lg leading-relaxed mfp-muted">
                  {s.paras.map((p, i) => <p key={i}>{p}</p>)}
                </div>
                {s.id === "foot-spa" && (
                  <div className="mfp-panel mt-6 overflow-x-auto p-2" data-testid="table-foot-spa">
                    <table className="w-full min-w-[640px] text-left text-sm">
                      <thead className="mfp-mono text-xs uppercase tracking-widest mfp-muted">
                        <tr>
                          <th className="p-3">Treatment</th><th className="p-3">Price</th><th className="p-3">Rewarded purchases</th><th className="p-3">Daily total</th><th className="p-3">Invites</th>
                        </tr>
                      </thead>
                      <tbody>
                        {TREATMENTS.map((t) => (
                          <tr key={t.name} className="border-t mfp-line" data-testid={`row-treatment-${t.name.toLowerCase()}`}>
                            <td className="p-3 font-semibold">{t.name}</td>
                            <td className="mfp-mono p-3">{t.price}</td>
                            <td className="mfp-mono p-3">{t.doubles}</td>
                            <td className="mfp-mono p-3">{t.total}</td>
                            <td className="p-3">{t.invite}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="p-3 text-sm mfp-muted">Pedicure starts at 30 points on the first purchase and reaches 15,360 on the last, for 30,690 in total. The daily totals assume all 10 purchases are made.</p>
                  </div>
                )}
                {s.items && (
                  <dl className="mt-6 grid max-w-3xl gap-3 sm:grid-cols-2">
                    {s.items.map((it, i) => (
                      <div key={it.t} className="mfp-panel p-5" data-testid={`item-${s.id}-${i}`}>
                        <dt className="font-bold">{it.t}</dt>
                        <dd className="mfp-muted mt-1 text-sm leading-relaxed">{it.d}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </section>
            ))}
          </div>
        </div>
      </div>
    </PublicShell>
  );
}
