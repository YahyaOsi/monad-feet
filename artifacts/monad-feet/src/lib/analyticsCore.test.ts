import test from "node:test";
import assert from "node:assert/strict";
import { ANALYTICS_CONSENT_KEY, ANALYTICS_ID_KEY, analyticsPage, createAnalyticsClient } from "./analyticsCore.ts";

function fixture(overrides: { host?: string; projectKey?: string; privacySignal?: boolean; networkError?: boolean; status?: number } = {}) {
  const values = new Map<string, string>();
  const sent: RequestInit[] = [];
  let sequence = 0;
  const client = createAnalyticsClient({
    projectKey: overrides.projectKey ?? "phc_public_project",
    host: overrides.host ?? "https://eu.i.posthog.com",
    basePath: "/monad-feet/",
    environment: "development",
  }, {
    storage: () => ({
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => { values.set(key, value); },
      removeItem: (key) => { values.delete(key); },
    }),
    randomId: () => `random-${++sequence}`,
    privacySignal: () => overrides.privacySignal ?? false,
    send: async (url, init) => {
      assert.equal(url, `${overrides.host ?? "https://eu.i.posthog.com"}/i/v0/e/`);
      sent.push(init!);
      if (overrides.networkError) throw new Error("Network unavailable");
      return new Response("{}", { status: overrides.status ?? 200 });
    },
  });
  return { client, values, sent };
}

test("nothing is sent before consent, after declining, or with a privacy signal", async () => {
  const f = fixture();
  assert.equal(await f.client.capture("$pageview", "/feed"), false);
  f.client.setConsent("declined");
  assert.equal(await f.client.capture("signup_completed"), false);
  assert.equal(f.sent.length, 0);
  assert.equal(f.values.has(ANALYTICS_ID_KEY), false);
  const dnt = fixture({ privacySignal: true });
  dnt.client.setConsent("accepted");
  assert.equal(await dnt.client.capture("signup_completed"), false);
  assert.equal(dnt.sent.length, 0);
});

test("opt-in sends only fixed properties and a random browser ID, with no referrer or credentials", async () => {
  const f = fixture();
  assert.equal(f.client.setConsent("accepted"), true);
  assert.equal(await f.client.capture("$pageview", "/monad-feet/profile/private-handle?token=secret"), true);
  const request = f.sent[0];
  const payload = JSON.parse(request.body as string);
  assert.equal(payload.distinct_id, "mf_anon_random-1");
  assert.deepEqual(payload.properties, {
    $process_person_profile: false, $geoip_disable: true, $lib: "monadfeet",
    environment: "development", page: "/profile/:id", $current_url: "/profile/:id", $pathname: "/profile/:id",
  });
  assert.equal(request.credentials, "omit");
  assert.equal(request.referrerPolicy, "no-referrer");
  assert.equal(request.keepalive, true);
  assert.equal(JSON.stringify(payload).includes("secret"), false);
  await f.client.capture("public_post_created");
  assert.equal(JSON.parse(f.sent[1].body as string).distinct_id, payload.distinct_id);
});

test("opting out deletes the browser ID and a later opt-in uses a new one", async () => {
  const f = fixture();
  f.client.setConsent("accepted");
  await f.client.capture("subscription_verified");
  f.client.setConsent("declined");
  assert.equal(f.values.get(ANALYTICS_CONSENT_KEY), "declined");
  assert.equal(f.values.has(ANALYTICS_ID_KEY), false);
  assert.equal(await f.client.capture("subscription_verified"), false);
  f.client.setConsent("accepted");
  await f.client.capture("signup_completed");
  assert.equal(JSON.parse(f.sent[1].body as string).distinct_id, "mf_anon_random-2");
});

test("configuration rejects missing project tokens, personal API keys, and unsupported hosts", () => {
  assert.equal(fixture({ projectKey: "" }).client.configured, false);
  assert.equal(fixture({ projectKey: "phx_private_personal_key" }).client.configured, false);
  assert.equal(fixture({ host: "https://example.com" }).client.configured, false);
  assert.equal(fixture({ host: "https://us.i.posthog.com" }).client.configured, true);
});

test("page categories redact dynamic identifiers and unknown paths", () => {
  assert.equal(analyticsPage("/post/123?invite=secret#token"), "/post/:id");
  assert.equal(analyticsPage("/search?q=secret"), "/search");
  assert.equal(analyticsPage("/monad-feet/feed", "/monad-feet/"), "/feed");
  assert.equal(analyticsPage("/unknown/private-data"), "/not-found");
});

test("network or storage failures are contained and cannot interrupt product actions", async () => {
  const network = fixture({ networkError: true });
  network.client.setConsent("accepted");
  assert.equal(await network.client.capture("signup_completed"), false);
  const rejected = fixture({ status: 403 });
  rejected.client.setConsent("accepted");
  assert.equal(await rejected.client.capture("signup_completed"), false);
  const unavailable = createAnalyticsClient({
    projectKey: "phc_public_project", host: "https://eu.i.posthog.com", basePath: "/", environment: "production",
  }, {
    storage: () => { throw new Error("Storage unavailable"); },
    randomId: () => "random",
    privacySignal: () => false,
    send: async () => { throw new Error("Network unavailable"); },
  });
  assert.equal(unavailable.setConsent("accepted"), false);
  assert.equal(await unavailable.capture("signup_completed"), false);
  assert.equal(unavailable.consent(), "declined");
});