export function MonadLoading({ signing = false }: { signing?: boolean }) {
  return (
    <div className="mf-loading-screen min-h-[100dvh] flex flex-col items-center justify-center gap-6 bg-background text-foreground"
      role="status" aria-label={signing ? "Confirm in your wallet" : "Loading Monad Feet"} data-testid="status-monad-loading">
      <style>{`
        .mf-loading-mark { position: relative; width: 108px; height: 108px; }
        .mf-loading-ring { position: absolute; inset: 0; border: 1px solid hsl(var(--primary) / .25); border-radius: 50%; animation: mf-loader-ripple 2.2s ease-out infinite; }
        .mf-loading-ring:nth-child(2) { animation-delay: 1.1s; }
        .mf-loading-foot { width: 42px; height: 62px; position: absolute; top: 23px; color: hsl(var(--primary)); animation: mf-loader-step 1.6s ease-in-out infinite; }
        .mf-loading-foot:first-of-type { left: 13px; transform: rotate(-15deg); }
        .mf-loading-foot:last-of-type { right: 13px; transform: rotate(15deg); animation-delay: .8s; }
        @keyframes mf-loader-step { 0%, 100% { opacity: .4; margin-top: 4px; } 50% { opacity: 1; margin-top: -4px; } }
        @keyframes mf-loader-ripple { 0% { transform: scale(.8); opacity: .8; } 100% { transform: scale(1.45); opacity: 0; } }
        @media (prefers-reduced-motion: reduce) { .mf-loading-ring, .mf-loading-foot { animation: none; } }
      `}</style>
      <div className="mf-loading-mark" aria-hidden="true">
        <span className="mf-loading-ring" />
        <span className="mf-loading-ring" />
        {[0, 1].map(foot => (
          <svg key={foot} className="mf-loading-foot" viewBox="0 0 42 62" fill="currentColor">
            <ellipse cx="21" cy="41" rx="11" ry="19" />
            <circle cx="11" cy="11" r="6" /><circle cx="24" cy="7" r="5" />
            <circle cx="34" cy="13" r="4" /><circle cx="38" cy="23" r="3" />
          </svg>
        ))}
      </div>
      <div className="text-center">
        <p className="text-2xl font-bold tracking-tight">Monad Feet</p>
        {signing && <p className="mt-2 text-sm text-muted-foreground">Confirm in your wallet</p>}
      </div>
    </div>
  );
}
