# Creator program backend integration — launch disabled

This change adds `/api/creator` to the existing backend and additive tables to
the existing database. The Creator Program frontend remains a separate app.
No code in this change sends funds or marks a transfer as paid.

## Identity and authorization

- The creator sign-in challenge is origin-bound, expires after five minutes,
  is single-use and is bound to the requesting browser session. EOA and
  ERC-1271 signatures use Monad Mainnet verification.
- A signed wallet must map to an existing `users` row with matching
  `verified_registrations` evidence. A legacy `registrationTxHash` field alone
  is insufficient. This change does not create main users or registration
  evidence.
- Real members share one program workspace, not authentication credentials.
  Sessions retain their own member ID. Signing out never expires another
  participant's workspace.
- Main user IDs, names, handles and wallets are authoritative. Preview samples
  remain isolated and have no main user IDs.
- Creator administrators must be registered users with signed sessions whose
  wallet is explicitly included in `CREATOR_ADMIN_WALLETS`. This allowlist
  grants **only creator-program permissions**, not main-app administration.
  It is empty by default. Repository ownership and the treasury address do
  not grant permissions.
- Cookie scope is `/api/creator`, HttpOnly and host-only. Browser mutations
  require Origin to match Host and reject cross-site requests. Header values
  such as `x-wallet-address` never establish creator identity.

## Review, badges and credits

Approved application reviews award the existing main-app `badges` table's
`creator_program` participation badge in the same transaction as approval.
It is not an identity-verification badge. X and Telegram ownership remain
manual reviews using the participant's verification code. Verified handles
cannot be approved for two participants in the same program.

Internal-post contributions must reference the signed user's own existing,
public, nonpaid `posts` row, and the submitted activity date must equal its
original UTC publication date. The check runs again at approval. No client
supplied points or scores are accepted. Scoring versions, proposed scores,
daily limits and weekly caps are snapshotted when submitted.

Final program points use largest-remainder rounding to allocate exactly
1,000,000 points. All weeks and reviews must be finalized first. Native
`reward_claims` provide idempotency; atomic increments update
`streaks.totalPoints` without replacing its balance. All credits and the
program finalization flag commit together or all roll back.

## MON allocation is not payment

The treasury is `0x23b4c6ddca73ba99045e1c0def939bd41932e773`, chain 143.
The weekly pool is **55% of its MON balance**, not retained revenue.
An administrator must explicitly confirm a balance matching a fresh,
block-bound RPC snapshot. Wei calculations and largest-remainder rounding
preserve the exact pool. Final weeks are immutable. A zero-score week is
recorded without paying or allocating funds.

Outstanding allocations are reserved: a new pool cannot overcommit the
treasury. There is deliberately no signing, payment-sending or payment-
confirmation endpoint in this PR. Approved payouts and chain-confirmed
reconciliation must be implemented and reviewed before recurring live
distributions. Do not change allocation statuses manually as a substitute.
RPC failure returns unavailable data, never a synthetic live balance.

## Schema review and rollout

1. Review the generated additive SQL under
   `scripts/creator-program-migration/` against a staging copy of the main
   database. The migration assumes the existing `users` table and adds only
   `creator_*` tables and their indexes and foreign keys.
2. Apply it to staging, regenerate the API, and test native accounts, social
   reviews, badge display, post eligibility and retry/concurrency of final
   credits. No production schema change is performed by this PR.
3. Route the separate creator frontend's `/api/creator` requests to this
   backend **under the creator frontend's own origin**. Preserve the public
   Host/Origin during proxying. Do not expose a permissive cross-origin API,
   use wildcard CORS or share cookies between subdomains.
4. The companion frontend must use `account.canReview` for review access,
   distinguish signed-in live accounts from previews, and use live
   `program.integrationReady`. Its sample-only guards and labels must be
   adapted before routing it here. This PR does not replace or merge the
   creator frontend into the social frontend.
5. Approve dates, review/appeal deadline and scoring; explicitly configure
   creator admin wallets. Keep the launch flag off until staging checks,
   frontend wiring, payout reconciliation and Telegram joining are ready.
6. Separately approve any production migration, deployment or financial
   operation. Opening or merging this PR is not approval to move funds.

## Nonsecret configuration

Defaults keep live application, contribution, review and credit mutations
closed. Preview mutations affect only their own samples.

| Variable | Required value before launch |
| --- | --- |
| `CREATOR_ADMIN_WALLETS` | Comma-separated, owner-approved registered wallets; empty means no live admin |
| `CREATOR_PROGRAM_ENABLED` | Literal `true`, only after launch approval |
| `CREATOR_RULES_APPROVED` | Literal `true`, after publishing the configured rules |
| `CREATOR_PROGRAM_START` | UTC Monday, `YYYY-MM-DD`, inclusive |
| `CREATOR_PROGRAM_END` | UTC Monday, `YYYY-MM-DD`, exclusive, after start and within 366 days |
| `CREATOR_REVIEW_GRACE_HOURS` | Owner-approved integer, 24–168 hours after week end for review/evidence/appeal |

Do not copy sample dates into production. Scoring starts in draft form; X
engagement tasks are disabled pending owner review of platform policy.
Finalization is allowed only after the relevant week and its grace period;
final main-app credits wait until program end and the last grace period.
Telegram group requests are recorded, but this change does not issue invite
links, autoapprove group membership or claim that a bot is connected.

## Verification

Run `pnpm run typecheck`, `pnpm --filter @workspace/api-server run test:creator`
and `pnpm --filter @workspace/api-server run build`.
Unit checks cover launch closure, administrator allowlisting, UTC dates,
review windows and exact integer allocations. HTTP checks exercise public
creator JSON, unauthenticated admin rejection, spoofed headers, CSRF and
validation errors. The main health check requires `RUN_DATABASE_TESTS=1` and
the main database schema; it is explicitly skipped without those fixtures.
These checks do not replace staging
database/API concurrency tests or browser-wallet/contract-wallet tests.
The integration must remain closed until those checks are completed.
