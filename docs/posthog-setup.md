# PostHog setup for MonadFeet

The app already contains a minimal integration with PostHog's public event capture API. Do not add a second SDK or installation snippet during PostHog onboarding: that could duplicate events or enable unintended autocapture.

## 1. Create the PostHog project

1. Open https://posthog.com and create an account.
2. Create a project named **MonadFeet** and choose your cloud region.
3. Choose Product Analytics. Find the **public project token / project API key** in the project settings.
4. Keep the region consistent:
   - EU Cloud: `https://eu.i.posthog.com`
   - US Cloud: `https://us.i.posthog.com`

## 2. Configure the app

In Replit, open **Tools → Secrets**, then add these two entries:

| Name | Value |
| --- | --- |
| `VITE_POSTHOG_PROJECT_KEY` | The public project token from PostHog |
| `VITE_POSTHOG_HOST` | The EU or US ingestion host above |

These Vite values are included in the browser bundle. Never put a private/personal PostHog API key in a `VITE_` variable. The integration rejects keys beginning with `phx_`.

Both values must be present and the host must match one of the two supported cloud regions. With no valid configuration, analytics stays off and no analytics prompt is shown.

Restart the web workflow for the preview to pick up the values. Rebuild/republish the app for the production site to pick them up; Vite reads them at build time.

## 3. Check real events

1. Visit https://monadfeet.social/ after publishing the configured version.
2. Choose **Accept analytics** in the optional analytics notice.
3. Navigate normally. A page view is enough to confirm delivery; no payment or new account is needed.
4. Open PostHog's live events/activity view. Look for `$pageview`.
5. Filter the `environment` property to `production`. Preview traffic is labeled `development`.

The other events are:

- `signup_completed`: the app has successfully saved registration.
- `public_post_created`: a non-exclusive post has been saved. This is not a claim that its optional on-chain anchor succeeded.
- `subscription_verified`: the payment flow's server verification succeeded. It can include a renewal or recovered payment and is not a financial ledger.

Do Not Track and Global Privacy Control disable collection. If you decline, no events are sent. A random analytics browser ID is stored only after accepting, and opting out deletes it. Logged-in users can change their preference in **Settings → Usage analytics**; guests have an **Analytics preferences** control.

The integration sends fixed page categories, not profile/post identifiers or query strings. It does not send wallets, usernames, content, messages, search terms, or private-post creation events. There is no session recording or DOM autocapture. PostHog still receives normal network connection metadata. Add the service, purpose, and data practices to the app's privacy notice; the consent control alone is not a complete legal privacy policy.

## 4. Connect DeltaV

1. Open https://deltav.monad.xyz/startup/monadfeet and edit the startup's analytics connections.
2. Click **Connect PostHog**.
3. Follow DeltaV's connection form and select/provide the MonadFeet project details it requests.
4. If it asks for a **personal API key** to read analytics, create a separate read-only key in PostHog with the scopes DeltaV explicitly requests, if supported. Enter that private key only in DeltaV's trusted connection form—not in a browser-exposed Vite variable or chat.
5. Confirm DeltaV shows the connection as active. If it shows no data yet, first check that PostHog received production events.

The app's public project token allows event ingestion; it is not a private read-access credential for DeltaV. Do not confuse the two.

## Metric limitations

Tracking starts after configuration and consent; it does not reconstruct old activity. Unique IDs represent opted-in browsers, not an authoritative registered-user total. Use the app database and verified transaction records for account and revenue reporting.