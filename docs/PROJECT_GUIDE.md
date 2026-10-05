# Monad Feet: Project Guide

## 1. What this project is

Monad Feet is a wallet-based social and creator-membership web application built around the Monad blockchain. Users join with a Monad wallet, create a profile, publish image posts, follow creator activity, message one another, earn activity rewards, and optionally pay a creator for access to exclusive posts. Creators can set a subscription price and view basic audience and revenue analytics.

It is a **hybrid application**, not a fully on-chain social network:

- PostgreSQL is the main application database for profiles, feed content, comments, messages, invites, notifications, reward history, subscriptions, preferences, and other app state.
- The Monad contract is used for selected registration, post, like, streak, profile, and subscription actions.
- The website and API connect those two systems, but several flows can currently diverge between the chain and the database.

The current codebase is a pnpm monorepo/workspace containing the web app, API, shared libraries, database schema, contract source, and a component-preview artifact.

## 2. Product and user flows

### Joining and signing in

1. A visitor connects a wallet with the RainbowKit/Wagmi wallet interface.
2. The app asks the API for a one-use sign-in challenge tied to the wallet, website origin, and Monad chain.
3. The user signs a message; the server verifies it and sets an HTTP-only session cookie.
4. A new user enters an invite code and profile details.
5. Onboarding asks the wallet to call `registerUser` on the platform contract. The API checks the successful transaction, chain, sender, call data, and `UserRegistered` event before recording the user and verified-registration evidence in the database.
6. Protected app pages require a valid wallet session and, for registered accounts, server-stored evidence of a verified on-chain registration.

There is no email/password account flow. Invite checking is an off-chain application rule; the Solidity `registerUser` function does not enforce or validate invite codes.

### Posting and social interaction

Signed-in users can publish image posts with captions, view a chronological or popular feed, like posts, comment, and browse individual post pages. The client also supports uploading images through the API’s object-storage flow. Some general posts can optionally be anchored by a contract transaction. Live activity and presence updates use WebSockets.

Likes, comments, feed ranking, much of the post data, and the activity stream are database-backed. A post’s database record is not itself proof that a matching on-chain action happened.

### Profiles and creators

Profiles show creator identity, posts, activity counts, badges, streak/point information, and subscription-related information. Users can edit profile fields and avatar, block/unblock other accounts, and open a conversation. Creator tools include subscription-price settings and basic subscriber/revenue/private-post analytics.

### Paid subscriptions and exclusive posts

Creators set a monthly MON amount in the database. A subscriber initiates `subscribe(creator)` against the configured Monad registry. The server then checks the receipt against the subscriber, creator, configured price, chain, registry, `Subscribed` event, expiry, and replay ledger before granting the database subscription. The private-post API checks for an unexpired subscription with an accepted payment record.

The app’s local Solidity reference intends to send 88% of the payment to the creator and 12% to the treasury for 30 days of access. **The exact deployed source has not been independently verified**, so the live split is not established solely by checking the contract’s current `feeRecipient()` value or a `Subscribed` event. The contract also accepts any positive amount; it does not enforce the database price on-chain. The app currently enables the flow at the user’s request, but it warns users to inspect the contract and amount in the wallet before signing.

### Direct messages

The app has conversation lists, message threads, unread counts/read receipts, WebSocket notifications, mute and block controls, and a creator setting that can require a subscription before a user messages them. Message data is stored off-chain.

The paid-DM prompt currently does **not** complete the paid subscription flow: it submits a subscription request without a transaction hash and treats the request as success without checking the HTTP result. Since the subscription API requires a confirmed payment, that prompt needs to be fixed.

### Wallet, points, invites, and discovery

The wallet/rewards area displays a MON balance, daily streak/check-in state, point totals, invite/referral information, reward tasks, and transaction-related information. Additional pages provide discovery, search, trending posts, leaderboards, notification controls, and a chain-status/function page.

The app contains milestone/badge and invite-related reward logic. Rewards and points are primarily database records; they are not automatically equivalent to tokens or independently enforceable on-chain assets. Any points shown as “on-chain” should be sourced from actual contract reads.

### NFT access

NFT-based admission is **not implemented**. The provided Monad address is a platform registry, not an NFT collection. The server’s NFT eligibility helper returns false, so registration remains invite-based. A separate NFT collection contract and a real ownership check would be required before NFT gating can work.

## 3. Pages and navigation

Routes are defined in `artifacts/monad-feet/src/App.tsx`. Apart from the landing and onboarding screens, the main product pages are protected by the wallet-backed user context.

| Route | Purpose |
| --- | --- |
| `/` | Landing page and wallet connection |
| `/onboarding` | Invite validation and new-user registration |
| `/feed` | Main post feed and create-post flow |
| `/discover` | Browse creators and users |
| `/trending` | Trending/ranked posts |
| `/post/:postId` | Post details, comments, and likes |
| `/private` | Exclusive posts for eligible subscribers |
| `/wallet` | MON balance and reward/streak area |
| `/leaderboard` | User ranking views |
| `/profile/:userId` | Profile, creator settings, analytics, and subscriptions |
| `/settings` | Account/profile and notification-related settings |
| `/notifications` | Activity notifications and preferences |
| `/chain` | Contract information, chain stats, and live event view |
| `/search` | Search people and content |
| `/messages` | Direct-message inbox and threads |

`artifacts/monad-feet/src/components/layout/AppLayout.tsx` contains responsive navigation, notification/message indicators, and live-event handling.

## 4. Technical architecture

### Workspace map

- `artifacts/monad-feet/`: React 19, TypeScript, Vite web client, page components, wallet integration, and UI components.
- `artifacts/api-server/`: Express API, authentication middleware, API routes, presence/WebSocket handling, milestone logic, and server-side chain verification.
- `artifacts/mockup-sandbox/`: isolated Vite component-preview/design artifact; it is not the production social app.
- `lib/db/`: Drizzle ORM, PostgreSQL connection, table definitions, and schema tooling.
- `lib/api-spec/`: OpenAPI source.
- `lib/api-zod/`: request/response validation schemas.
- `lib/api-client-react/`: generated React Query API client.
- `lib/object-storage-web/`: browser-side upload helper.
- `contracts/MonadFeet.sol`: local Solidity reference implementation.
- `scripts/`: workspace helper scripts.
- `docs/`: chain-status notes and this project guide.

The root `pnpm-workspace.yaml`, `pnpm-lock.yaml`, TypeScript configuration, and package manifests define workspace packages and shared dependency versions.

### Web and API communication

The browser talks to the Express API under `/api`. API routers are assembled in `artifacts/api-server/src/routes/index.ts`; `artifacts/api-server/src/app.ts` applies wallet-session protection before routing. Shared OpenAPI/Zod/client packages are intended to keep request and response shapes aligned, but there is no comprehensive automated contract test proving every route matches the generated API contract.

### Authentication and request identity

Wallet authentication is implemented in `artifacts/api-server/src/lib/walletAuth.ts` and `walletAuthRules.ts`. Challenges are short-lived and single-use. A verified signature results in a random session token stored as a hash in PostgreSQL and delivered in an HTTP-only cookie. Same-origin checks protect writes; production cookies are marked Secure. The wallet header is treated as a convenience value, not a trusted identity: middleware replaces/checks it against the session and checks wallet-address values in request bodies.

Registered users need verified on-chain registration evidence for most protected API operations. The middleware intentionally fails closed when an old user has only a legacy registration hash but no verified evidence row.

### Database and files

The application uses PostgreSQL through Drizzle. Database connection setup expects `DATABASE_URL`. The schema is under `lib/db/src/schema/`; it includes users/invites, posts/likes/comments, private posts, subscription/payment records, auth challenges/sessions, registration evidence, streaks, notifications, direct messages, preferences, blocks, and related reward state.

Images use an object-storage service rather than a local filesystem. Replit’s current storage integration needs compatible provider setup if the project is run elsewhere. Private-content authorization must be enforced by the API/storage layer, not merely by hiding an image URL in the frontend.

### Monad contract

- Network: Monad Mainnet, chain ID `143`.
- RPC used in the current source: `https://rpc.monad.xyz`.
- Platform registry: `0x616929D84ED483a26a568fC97A364e5c5eCBe39D`.
- Configured treasury: `0x23B4C6DdcA73ba99045E1c0Def939BD41932E773`.
- Frontend ABI and address configuration: `artifacts/monad-feet/src/lib/contract.ts`.
- Wallet write helper: `artifacts/monad-feet/src/lib/useContractActions.ts`.
- Server transaction verification: relevant route modules under `artifacts/api-server/src/routes/`.

The current source is `contracts/MonadFeetV2.sol`; the previous source is preserved separately. It describes registration, post anchors, permanent likes, separate daily check-ins, profile metadata, subscriptions, and the paid feet-care game. The treasury is immutable. Compiling the supplied source with Solidity 0.8.34, optimizer disabled and Osaka produced matching executable runtime after immutable substitution; metadata differs. This is not an independent security audit or explorer verification. See `docs/contract-verification.md` for reproducible checks, 25 read-only simulations, and remaining risks.

### Daily feet-care game

The `/daily` page reads live contract state and offers Wash Feet (1.43 MON, initially 5 points), Massage Feet (14.3 MON, initially 7 points), and Pedicure (143 MON, initially 15 points). Each action allows ten purchases per UTC day; its points double with each purchase and reset daily. All game fees go to the treasury, with network gas paid separately.

Every fifth lifetime purchase emits an invite event. The API verifies the confirmed transaction and event, then atomically credits app points and creates a usable invitation with a permanent replay ledger. The app retains pending hashes for retry without another payment. Contract points and app points are separate balances; existing app bonuses are not mirrored on chain. Game purchases do not advance the daily check-in streak.

Existing accounts may need to register on this new deployment through the Daily page. This explicit wallet action does not migrate previous posts, likes, subscriptions, or history. Legacy accounts without server-verified registration evidence still require the separately planned reconciliation.

## 5. What is implemented and what has been checked

“Implemented” means corresponding code exists; it does not mean every edge case has end-to-end validation or the feature is production-ready.

### Implemented in the codebase

- Wallet connect, signature challenge/session creation, logout, protected routing.
- Invite validation and receipt-verified new on-chain registration.
- Profiles, profile editing, image posts, comments, likes, feeds, discovery, search, trending, and leaderboards.
- Exclusive/private post creation and a database-based subscription check for the private-post API.
- Subscription prices, the paid-subscription UI, live treasury preflight, server receipt verification, permanent transaction-hash ledger, renewal handling, and subscription notifications.
- Direct messages, read state, mute/block actions, and subscription-required DM settings.
- Streak and reward endpoints, referral/invite logic, notifications/preferences, and badges.
- On-chain reads/writes for the contract methods represented in the client ABI.
- Object-storage upload and serving routes.
- WebSocket activity/presence functions.

### Verified recently in this workspace

- Frontend and API TypeScript checks completed successfully after the payment integration changes.
- A focused run of the wallet-authentication and rewards unit tests passed (six tests total).
- API and web workflows started successfully.
- Read-only Monad RPC call to `feeRecipient()` returned the configured treasury.
- No real-money transaction was sent as a test.

### Not verified

- No full browser-to-database-to-Monad end-to-end payment test.
- No proof that deployed contract bytecode is exactly produced by `contracts/MonadFeet.sol`.
- No proof that the deployed code performs the advertised 88/12 transfers.
- No complete database migration/restore test or migration of old accounts and content.
- No comprehensive API, storage-ACL, contract, or E2E test suite.
- No production deployment validation.

## 6. Important gaps and fixes, ordered by impact

### Implemented: private media and paid-content authorization

`artifacts/api-server/src/routes/storage.ts` now checks object ownership and active receipt-backed subscriber access before looking up or streaming a protected object. Upload provenance is server-owned; new private posts cannot use externally hosted or public images. Existing ambiguous objects fail closed without deletion.

General paid post reads, detail, search, analytics, comments, notifications, and realtime payloads are protected. Locked response shells retain public identifiers but omit protected captions/images. Analytics are creator-only. Nine isolated HTTP tests cover authorization, forgery, aliases, deletion, caches, and no unauthorized byte streaming. See `docs/LAUNCH-READINESS.md` for deployment and external-URL limitations.

### Critical: make payment settlement resistant to failures

`artifacts/api-server/src/routes/subscriptions.ts` verifies the configured price after the chain transaction is already mined. The Solidity contract accepts any positive amount and does not know the creator’s database price. If the creator changes their price while a subscriber is signing, the API may reject a transaction after MON has already been transferred. There is no refund/reconciliation path.

Before calling the payment flow production-safe:

1. Independently verify deployed bytecode against reviewed source or deploy a verified replacement.
2. Enforce the accepted amount in the contract, or otherwise design a safe quote/price-version mechanism that cannot charge and then reject a valid user payment.
3. Verify actual payout behavior, not just a treasury getter and an emitted event.
4. Add recovery/support procedures for transactions that succeed on-chain but fail to persist in PostgreSQL.
5. Exercise duplicate, delayed, dropped, mismatched-price, creator-change, and database-failure cases without using real funds.

The current code intentionally warns that source verification is incomplete.

### High: repair paid direct-message subscription prompt

`artifacts/monad-feet/src/pages/messages.tsx` submits a subscription request without a transaction hash, does not check `response.ok`, and calls the completion callback even when the API rejects the request. The API correctly requires a verified on-chain receipt, so the UI prompt cannot currently grant the subscription. Route users through the same wallet transaction, verification, error, and pending-state flow as profile subscriptions.

### High: verify all chain evidence server-side

- `PATCH /posts/:postId/anchor` accepts a `0x`-prefixed hash and stores it without verifying the transaction, sender, function, or event.
- Like and daily-check-in API paths can record off-chain results while the chain action was skipped, rejected, or failed; the daily-check-in hash is optional and not verified by the API.
- Some frontend flows deliberately continue with database writes after a user declines or a chain write fails.

Either verify every hash/receipt before describing the action as on-chain, or label it clearly as off-chain and keep the database and chain status separate. Add idempotency and reconciliation for a chain success followed by a database failure.

### High: reconcile existing users and history

The API requires a `verified_registrations` row for protected requests. Old accounts whose registration predates the evidence table can be denied access even if the user has a historical `registrationTxHash`. Existing users, posts, likes, subscriptions, and profile history are not automatically recreated in the new contract. Use an explicit, backed-up, receipt-verified migration; do not silently fabricate on-chain history.

There is no established production schema-migration workflow in the repository. `pnpm --filter @workspace/db run push` is a development schema command, not a tested production data migration. Review the target database, backup it, and define rollback/reconciliation steps before schema changes.

### High: fix paid-post and creator authorization invariants

Confirm that every write’s creator/author is the identity in the signed server session, and every read of private material is authorized against that same identity and active subscription. Middleware currently binds submitted wallet-address fields to the signed session, but security must be tested at the route and object level rather than assumed from frontend behavior.

### Medium: clarify what “on-chain” means in the interface

Many important features—invite validation, comments, messages, notification preferences, moderation, price settings, payment ledger records, and most profile/post data—are database-backed. The `/chain` page and copy should distinguish real contract reads/receipts from off-chain application state. The local contract’s likes are permanent, whereas the app supports removing a like; the two systems therefore need an explicit policy.

### Medium: finish and test product details

- Fix the Weekly Digest preference control; it currently reuses the System Alerts preference.
- Profile post lists use a feed query and client-side filtering, so pagination/default feed size may omit older posts.
- Replace empty/overridden React Query keys where they can collide across user IDs or parameters.
- The chain events page is a live view without historical backfill; clarify that events are only observed while watching.
- Validate uploads by size, content type, and actual file content; add abuse limits.
- Add robust DB/API/chain integration tests, private-media access tests, and browser-level flows.
- Verify transaction failures and HTTP errors are displayed instead of silently ignored.

### Medium: finish operational and product configuration

- NFT admission is a stub; provide and independently verify a real NFT collection before advertising this feature.
- RPC address, contract, treasury, and some chain settings are constants; move environment-specific configuration to validated deployment settings.
- Public RPC limits may affect production reliability; add appropriate rate limiting, retries, monitoring, and a reliable RPC provider.
- Wallet-auth throttling is per process, so it needs a shared limiter if the API runs multiple replicas.
- Configure production object storage and access policy.
- Create explicit backup/restore, schema migration, chain reconciliation, incident, and support procedures.
- The repository has no confirmed production deployment or tested multi-instance configuration.

## 7. Setup and common commands

Use Node.js 24 and pnpm. From the workspace root:

```sh
pnpm install --frozen-lockfile
```

Create `.env` from `.env.example` and configure secrets locally or through the host’s secrets manager. The API needs a PostgreSQL `DATABASE_URL` and a strong `SESSION_SECRET`; object uploads need a compatible object-storage configuration. Never commit real values.

In separate terminals:

```sh
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/monad-feet run dev
```

Checks:

```sh
pnpm run typecheck
pnpm run build
```

For a development database only, review the schema changes and then use:

```sh
pnpm --filter @workspace/db run push
```

Do not run schema changes against production without a backup and reviewed migration/rollback plan. Running the code locally also does not automatically configure Replit object storage for a non-Replit host.

## 8. Key files to start reading

- Product routes and protection: `artifacts/monad-feet/src/App.tsx`
- Main navigation: `artifacts/monad-feet/src/components/layout/AppLayout.tsx`
- Wallet/session onboarding: `artifacts/monad-feet/src/context/UserContext.tsx`, `src/pages/onboarding.tsx`
- Contract configuration and wallet writes: `artifacts/monad-feet/src/lib/contract.ts`, `src/lib/useContractActions.ts`
- API wiring: `artifacts/api-server/src/app.ts`, `src/routes/index.ts`
- Wallet authentication: `artifacts/api-server/src/lib/walletAuth.ts`, `src/lib/walletAuthRules.ts`
- Subscription verification/access: `artifacts/api-server/src/routes/subscriptions.ts`
- Data model: `lib/db/src/schema/`
- Contract reference: `contracts/MonadFeet.sol`
- Chain evidence and caveats: `docs/CHAIN-STATUS.md`
- GitHub setup overview: `README.md`