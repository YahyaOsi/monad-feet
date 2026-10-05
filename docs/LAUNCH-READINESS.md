# Launch readiness — final test pass

Status: **creator-approved invite-only beta with payments active**. This is not an audited or fully verified paid production release.

## Approved beta release

The creator explicitly chose to publish an invite-only beta with game and subscription payments active, accepting the documented testing gaps. No payment pause was applied; authentication, receipt verification, quotes, replay protection, and private-media authorization remain enforced.

On production startup, a database with no users AND no invitations receives one cryptographically random team invitation. Startup is serialized across instances using a transaction advisory lock. No existing records are deleted or changed, and the invitation is never logged or returned publicly. Retrieve it privately from the production `invite_codes` table through the database pane, then share it only with the first tester. Existing databases never receive replacement codes automatically.

Publish with the current schema (including registration evidence, media provenance, payment quotes and ledgers). Prefer a fresh production database without development fixtures. NFT admission and token conversion are not implemented/configured and must not be represented as active; the planned NFT date does not enable admission.

## Latest final check

The profile price defect found in browser testing was traced to unrelated resources sharing an explicitly empty query-cache key. Those overrides were removed throughout the frontend. Invalid/loading/error price states now disable payment rather than rendering an undefined price. Two cache-key regression tests, frontend typecheck, and production build passed after the fix; the frontend restarted successfully.

The latest isolated browser checks verified registration recovery across reload, rejected registration staying on onboarding, and DM subscription recovery: verification failure keeps DMs locked and retains the hash; successful mocked retry unlocks without another send. These are mocked settlements, not real-chain payment evidence.

Outstanding paid-launch risks remain: the immutable contract can charge a transaction mined after its quote deadline; actual successful wallet settlement is unverified; and first-production schema, invitation provisioning, and storage delivery have not been checked. No full paid-launch clearance or publication is implied.

## Fresh-production onboarding / owner-only invitation bootstrap

Do not copy development rows into the first production database. Preserve the four
unverified test accounts in development; do not delete or grant them verification.
The owner must provision a clean production database and review/apply the complete
`lib/db/src/schema/index.ts` schema with the publishing database tooling before opening
traffic. The additive security/media SQL files alone are **not** a complete fresh
schema. Never use `push-force`, destructive seed scripts, or automatic startup seeds.
Verify all schema tables, columns, unique indexes and foreign keys, including wallet
challenges/sessions, verified registrations, invitations and streaks.

Development rehearsal (no mutation by default):

```sh
node scripts/bootstrap-invite.cjs
# Optional explicit development-only provisioning:
NODE_ENV=development node scripts/bootstrap-invite.cjs --apply-development
node --test scripts/bootstrap-invite.test.cjs
```

This script refuses production/external URLs and deployed environments, inserts at
most one unused team invitation, never deletes records, and never prints the code.
It is not wired to build or startup.

For production, the **owner**, not the agent or public API, must use a trusted
database administration connection after reviewing the target database. Generate a
fresh 20-byte cryptographically random value offline (`crypto.randomBytes(20)` in
Node), encode as uppercase hexadecimal, and keep it secret. In one transaction lock
`invite_codes` in `SHARE ROW EXCLUSIVE` mode, check for an existing unused row with
null `owner_id`, and only if none exists insert the generated code using a bound
parameter (`INSERT INTO invite_codes (code) VALUES ($1)`). Commit and retrieve the
code privately; never put it in source, logs, URLs, public docs or environment
defaults. Send it privately to the first real user. Subsequent users receive the
normal invitations created transactionally with that user's profile. No production
bootstrap has been performed here.

The first user must connect and sign the wallet-session challenge, validate that
invitation, and submit a real registration to the configured Monad chain-143
registry. The server still checks receipt, sender, contract, calldata, event and
current chain state, then atomically creates profile/evidence and redeems the invite.
Browser recovery saves the submitted public hash with the original invite/username;
on profile-save failure or reload use **Verify receipt and save profile**, not a
second transaction. Storage is best-effort: wallet history provides manual hash
recovery. Treat browser-local invitation data as sensitive and clear it after use.
If the original transaction reverted, confirm that in wallet history before clearing
its hash. No UI recovery grants admission without the server's cryptographic checks.

Artifact web production configuration already supplies `PORT=22664` and `BASE_PATH=/`;
API startup uses `PORT=8080`. When invoking the web build outside artifact tooling,
provide those variables explicitly. No metadata rewrite was necessary.

## Passed

- Workspace TypeScript checks, including frontend, API, shared libraries, and scripts.
- Frontend production build with its configured `PORT=22664` and `BASE_PATH=/`.
- API production build.
- Twelve authentication, reward-rule, and chain-receipt unit tests.
- Isolated mocked-browser wallet connection and authenticated Daily page at desktop and 390×844 mobile sizes.
- Exact displayed game fees, initial points, ten-per-action limits, and payment confirmation details.
- Failed purchase attempt left mocked rewards and counts unchanged.
- Manual transaction recovery: verification unavailable, pending hash preserved across reload, retry of the same hash credited the mocked award without a new transaction.

The root workspace build initially failed because a standalone shell lacked the artifact-provided PORT/BASE_PATH configuration for the canvas sandbox. App-specific production builds passed with their configured environment.

## Test boundaries

No real wallet key was used, no real MON was spent, and no blockchain or production records were changed. Browser authentication and reward responses were intercepted test fixtures, not evidence of real-wallet payment settlement.

The browser harness rejected transaction methods. The observed purchase attempt stopped with “No payment sent / Missing or invalid parameters”; this does not prove the full real-wallet signing and successful receipt flow.

The test runner used inline fixture logic because its environment could not dynamically import the helper. Its fallback omitted the history response, so successful history rendering remains unverified. Background telemetry/resource errors were also present in that isolated environment.

Runtime/source comparison, 25 read-only contract simulations, and development-database concurrent claim/rollback tests passed in the earlier integration pass; they were not repeated here. See `contract-verification.md`.

## Private-content blocker resolved in development

Private media now requires owner access or an active positive-price subscription backed by matching permanent payment evidence. New uploads record server-owned provenance; cross-owner attachment and public/private alias conflicts fail closed. Locked paid posts return no caption or image URL, including search, analytics, notifications, and websocket paths. Creator analytics are owner-only.

Nine HTTP integration tests passed through the actual Express app and authentication middleware, using an isolated temporary database schema and a mocked object-store download. They cover owner/subscriber/non-subscriber, expired and invalid payment evidence, anonymous access, path aliases, upload forgery, conflicting binding, deletion, protected response fields, comments, cache headers, and owner-only analytics. Unauthorized requests do not reach the object download. Run `pnpm --filter @workspace/api-server run test:privacy`.

Additive development schemas were applied without modifying users or inserting verification evidence. All declared tables and columns are present. The creator confirmed the four existing accounts are development test accounts; they remain unverified and do not need registration recovery. Reproducible SQL: `lib/db/media-privacy.sql` and `lib/db/security-prerequisites.sql`.

Production schema application and real cloud-storage delivery have not been validated. Previously disclosed external/public URLs and already-downloaded copies cannot be revoked by these application changes. Legacy objects with ambiguous ownership fail closed; no content was deleted or automatically relabeled.

## Other release boundaries

### Registration reconciliation and publication check

The authorized development reconciliation inspected four existing users. All four lacked a stored registration transaction hash, so none could be verified or granted access. Dry-run, explicit development apply, and repeat dry-run inserted zero evidence rows. Two redeemed invitations exist, but invitations alone are not chain-registration proof. No identities, historical content, or admission records were changed.

On 2026-09-30 the creator confirmed these are test accounts. Their missing receipts are therefore **not a real-user migration blocker**. Keep them unverified and preserved in development. Recommended first-publication policy: start production without development test data, then provision fresh unused invitations for real onboarding. This is a recommendation, not a claim that production data selection or invitation provisioning has happened. Do not copy fixture authentication/session/payment evidence into production.

The new `scripts/reconcile-registrations.cjs` defaults to dry-run and requires an explicit development-only apply option. Its twelve tests passed. Recovery requires original public registration transaction hashes and matching wallet, username, registry, event, state, and invitation evidence; missing evidence must not be manufactured.

The deployment service reports this app has not been published, and the production-database check reports no production database exists yet. Production schema/data and end-to-end delivery therefore cannot be verified before a first publication. Review the supported publishing database/schema settings; do not assume development users are automatically copied or verified.

- Contract subscriptions accept any positive value; the app's exact-price receipt verification must remain mandatory for paid access.
- Existing chain registration, post, and subscription history has not been migrated.
- Real-wallet successful payment and receipt-to-API reconciliation are not certified by the mocked browser checks.
- No publication was performed, and this report does not claim every existing feature was tested.