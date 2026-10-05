export type AnalyticsConsent = "accepted" | "declined" | null;
export type ProductEvent = "signup_completed" | "public_post_created" | "subscription_verified";
export const ANALYTICS_CONSENT_KEY = "mf_analytics_consent";
export const ANALYTICS_ID_KEY = "mf_analytics_browser_id";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type Config = { projectKey: string; host: string; basePath: string; environment: string };
type Dependencies = {
  storage: () => StorageLike;
  send: typeof fetch;
  randomId: () => string;
  privacySignal: () => boolean;
};

const pages = new Set([
  "/", "/onboarding", "/feed", "/discover", "/trending", "/private", "/wallet",
  "/daily", "/leaderboard", "/settings", "/notifications", "/chain", "/search", "/messages",
]);

/** Never send handles, IDs, query strings, search terms, or unknown route values. */
export function analyticsPage(rawPath: string, basePath = ""): string {
  let path = rawPath.split(/[?#]/, 1)[0];
  const base = basePath.replace(/\/$/, "");
  if (base && (path === base || path.startsWith(`${base}/`))) path = path.slice(base.length);
  path = path.replace(/\/+$/, "") || "/";
  if (pages.has(path)) return path;
  if (/^\/post\/[^/]+$/.test(path)) return "/post/:id";
  if (/^\/profile\/[^/]+$/.test(path)) return "/profile/:id";
  return "/not-found";
}

/** PostHog's public capture API; no SDK autocapture or session recording. */
export function createAnalyticsClient(config: Config, deps: Dependencies) {
  const key = config.projectKey.trim();
  const host = config.host.trim().replace(/\/$/, "");
  const configured = Boolean(key && !key.startsWith("phx_")
    && ["https://us.i.posthog.com", "https://eu.i.posthog.com"].includes(host));
  let forcedOff = false;

  function consent(): AnalyticsConsent {
    if (forcedOff) return "declined";
    try {
      const value = deps.storage().getItem(ANALYTICS_CONSENT_KEY);
      return value === "accepted" || value === "declined" ? value : null;
    } catch { return null; }
  }

  function setConsent(value: Exclude<AnalyticsConsent, null>): boolean {
    // A failed preference write must never keep collection on after opting out.
    forcedOff = true;
    try {
      const storage = deps.storage();
      storage.setItem(ANALYTICS_CONSENT_KEY, value);
      if (value === "declined") storage.removeItem(ANALYTICS_ID_KEY);
      forcedOff = false;
      return true;
    } catch { return false; }
  }

  async function capture(event: ProductEvent | "$pageview", rawPath?: string): Promise<boolean> {
    if (!configured || deps.privacySignal() || consent() !== "accepted") return false;
    try {
      const storage = deps.storage();
      let id = storage.getItem(ANALYTICS_ID_KEY);
      if (!id) {
        id = `mf_anon_${deps.randomId()}`;
        storage.setItem(ANALYTICS_ID_KEY, id);
      }
      const page = event === "$pageview" ? analyticsPage(rawPath ?? "/", config.basePath) : undefined;
      const response = await deps.send(`${host}/i/v0/e/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "omit",
        referrerPolicy: "no-referrer",
        keepalive: true,
        body: JSON.stringify({
          api_key: key,
          event,
          distinct_id: id,
          properties: {
            $process_person_profile: false,
            $geoip_disable: true,
            $lib: "monadfeet",
            environment: config.environment,
            ...(page ? { page, $current_url: page, $pathname: page } : {}),
          },
          timestamp: new Date().toISOString(),
        }),
      });
      return response.ok;
    } catch {
      // Optional telemetry must not interrupt registration, posts, or payments.
      return false;
    }
  }

  return { configured, consent, setConsent, capture, privacySignal: deps.privacySignal };
}