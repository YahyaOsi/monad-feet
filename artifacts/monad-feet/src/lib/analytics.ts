import { createAnalyticsClient, type AnalyticsConsent, type ProductEvent } from "./analyticsCore";

export const ANALYTICS_PREFERENCE_EVENT = "mf:analytics-preference";

export const analytics = createAnalyticsClient({
  projectKey: import.meta.env.VITE_POSTHOG_PROJECT_KEY ?? "",
  host: import.meta.env.VITE_POSTHOG_HOST ?? "",
  basePath: import.meta.env.BASE_URL,
  environment: import.meta.env.PROD ? "production" : "development",
}, {
  storage: () => window.localStorage,
  send: (url, init) => fetch(url, init),
  randomId: () => crypto.randomUUID(),
  privacySignal: () => navigator.doNotTrack === "1"
    || (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true,
});

export function setAnalyticsConsent(value: Exclude<AnalyticsConsent, null>): boolean {
  const saved = analytics.setConsent(value);
  window.dispatchEvent(new Event(ANALYTICS_PREFERENCE_EVENT));
  return saved;
}

export function trackProductEvent(event: ProductEvent): void {
  void analytics.capture(event);
}

export function trackPageView(path: string): void {
  void analytics.capture("$pageview", path);
}