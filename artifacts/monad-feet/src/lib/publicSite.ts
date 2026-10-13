import { useEffect, useState } from "react";

/** Match the existing UTC boundary for early beta eligibility. */
export const BETA_ENDS_AT = Date.parse("2026-10-10T00:00:00Z");

export function isBetaPeriod(now = Date.now()): boolean {
  return now < BETA_ENDS_AT;
}

export function useBetaStatus() {
  const [isBeta, setIsBeta] = useState(() => isBetaPeriod());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    function refresh() {
      if (timer) clearTimeout(timer);
      const remaining = BETA_ENDS_AT - Date.now();
      setIsBeta(remaining > 0);
      if (remaining > 0) timer = setTimeout(refresh, Math.min(remaining, 2_147_483_647));
    }
    refresh();
    document.addEventListener("visibilitychange", refresh);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  return isBeta;
}

export const PROJECT_SOCIALS = {
  x: "https://x.com/MonadFeet",
  telegram: "https://t.me/MonadFeet",
};
