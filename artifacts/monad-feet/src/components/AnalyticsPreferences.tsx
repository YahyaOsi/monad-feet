import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useUser } from "@/context/UserContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ANALYTICS_PREFERENCE_EVENT, analytics, setAnalyticsConsent, trackPageView } from "@/lib/analytics";
import { type AnalyticsConsent, ANALYTICS_CONSENT_KEY } from "@/lib/analyticsCore";

function useAnalyticsPreference() {
  const [consent, setConsent] = useState(analytics.consent);
  const [error, setError] = useState("");
  useEffect(() => {
    const update = () => setConsent(analytics.consent());
    const onStorage = (event: StorageEvent) => {
      if (event.key === ANALYTICS_CONSENT_KEY || event.key === null) update();
    };
    window.addEventListener(ANALYTICS_PREFERENCE_EVENT, update);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(ANALYTICS_PREFERENCE_EVENT, update);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  const choose = (value: Exclude<AnalyticsConsent, null>) => {
    const saved = setAnalyticsConsent(value);
    setError(saved ? "" : "Your preference could not be saved. Analytics is off for this visit.");
    return saved;
  };
  return { consent, choose, error };
}

export function AnalyticsPageTracker() {
  const [location] = useLocation();
  const { consent } = useAnalyticsPreference();
  useEffect(() => { trackPageView(location); }, [location, consent]);
  return null;
}

const description = "Optional PostHog analytics helps us understand page visits and completed actions. "
  + "A random browser ID is stored only if you accept. We don't send wallet addresses, usernames, "
  + "post content, messages, or search terms, and we don't record sessions.";

export function AnalyticsConsentBanner() {
  const { user } = useUser();
  const { consent, choose, error } = useAnalyticsPreference();
  const [open, setOpen] = useState(false);
  if (!analytics.configured || analytics.privacySignal()) return null;
  if (consent !== null && !open) {
    return !user ? (
      <div className="fixed bottom-4 left-4 z-50">
        <button className="rounded-md border bg-background px-3 py-2 text-xs text-muted-foreground shadow-sm hover:text-foreground"
          onClick={() => setOpen(true)} data-testid="button-analytics-preferences">
          Analytics preferences
        </button>
      </div>
    ) : null;
  }
  const decide = (value: Exclude<AnalyticsConsent, null>) => setOpen(!choose(value));
  return (
    <section aria-label="Optional analytics" className="fixed inset-x-3 bottom-24 z-[80] rounded-xl border bg-background p-4 shadow-xl md:inset-x-auto md:bottom-4 md:right-4 md:max-w-md"
      data-testid="analytics-consent-banner">
      <h2 className="font-semibold">Help improve MonadFeet</h2>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
      <p className="mt-2 text-xs text-muted-foreground">You can change this choice in Settings. Turning it off stops future collection in this browser.</p>
      {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button onClick={() => decide("accepted")} data-testid="button-accept-analytics">Accept analytics</Button>
        <Button variant="outline" onClick={() => decide("declined")} data-testid="button-decline-analytics">No thanks</Button>
      </div>
    </section>
  );
}

export function AnalyticsPrivacySettings() {
  const { consent, choose, error } = useAnalyticsPreference();
  const privacySignal = analytics.privacySignal();
  const active = analytics.configured && !privacySignal && consent === "accepted";
  return (
    <Card data-testid="analytics-privacy-settings">
      <CardHeader>
        <CardTitle>Usage analytics</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm" role="status">
          {!analytics.configured ? "Analytics is not configured."
            : privacySignal ? "Analytics is off because your browser requests no tracking."
            : active ? "Analytics is on for this browser." : "Analytics is off for this browser."}
        </p>
        {analytics.configured && !privacySignal && (
          <Button variant={active ? "outline" : "default"} onClick={() => choose(active ? "declined" : "accepted")}
            data-testid="button-toggle-analytics">{active ? "Turn off analytics" : "Allow analytics"}</Button>
        )}
        <p className="text-xs text-muted-foreground">Turning it off stops future collection and removes the analytics browser ID. It does not erase events already sent.</p>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}