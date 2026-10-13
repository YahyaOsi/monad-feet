# Monad Feet chain status

## Current deployment

- Monad Mainnet, chain ID **143**.
- Registry: `0x616929D84ED483a26a568fC97A364e5c5eCBe39D`.
- Treasury: `0x23B4C6DdcA73ba99045E1c0Def939BD41932E773`.
- Supplied source: `contracts/MonadFeetV2.sol`; old `contracts/MonadFeet.sol` is historical.
- Executable runtime matches the compiled supplied source after immutable substitution; Solidity metadata differs. Full live runtime is pinned in frontend and server checks.
- This is **not an independent audit or explorer verification**. Full evidence and reproducible commands: [contract-verification.md](contract-verification.md).

No real transactions, deployments, payments, record migrations, or publishing were performed during verification.

## Game behavior

| Action | Fee | First points | Daily cap | Points for all ten |
| --- | ---: | ---: | ---: | ---: |
| Wash Feet (1) | 1.43 MON | 5 | 10 | 5,115 |
| Massage Feet (2) | 14.3 MON | 7 | 10 | 7,161 |
| Pedicure (3) | 143 MON | 15 | 10 | 15,345 |

Points double per action purchase within a UTC day. Counts and doubling reset at UTC midnight; lifetime purchases do not reset. All 30 purchases cost 1,587.30 MON plus gas, award 27,621 points, and emit six invite awards.

Game fees transfer entirely to the treasury. Every fifth lifetime purchase emits `InviteEarned`; the API turns confirmed events into usable invitation codes atomically with app points and a permanent transaction replay ledger. Retrying a claim cannot duplicate rewards. Sending may be disabled independently of syncing existing confirmed purchases.

`dailyCheckin()` is separate. Contract check-in awards are 5 points before day 7, 10 from day 7, and 20 from day 30. Existing app check-in bonuses (10 points plus milestones) remain separate; the UI distinguishes app and contract balances.

## What has been checked

- Current social update: five receipt-test groups cover matching direct receipts, tampered chain/calldata/event evidence, and verified inner wallet calls. Authenticated synthetic development API checks reject publication without a receipt and with a nonexistent receipt, leave pending history unpublished, and return 405 for deletion, unlike, and unverified anchor updates. These fixtures are not mainnet settlement evidence.
- CHOG Genesis ownership reads against Monad Mainnet confirmed holder and non-holder results. Signed-in browser checks and successful real-wallet publication/admission remain unverified because the injected test-wallet handshake did not complete.
- 25 read-only mainnet simulations: correct/incorrect fees, all point sequences, limits, independent counters, UTC reset, registration requirement, treasury receipt/rejection, invite events, and separate streak behavior.
- Executable runtime comparison using official Solidity 0.8.34, optimizer disabled, Osaka.
- Adversarial server receipt tests and development-database tests for concurrent claims, replay rejection, no lost points, and transaction rollback.
- Frontend/backend typechecks. Browser checks are reported separately; mocked browser scenarios are not real-wallet payment tests.

## Remaining launch boundaries

- **Subscription price enforcement is missing on chain.** A one-wei subscription succeeds, although the app's API requires the creator's exact listed price and matching payment evidence. Do not authorize private content from `isSubscribed` alone. Subscription renewals replace rather than extend expiry.
- **Treasury behavior can change.** It is an EIP-7702 delegated account, not a code-free EOA. Current reception was simulated successfully; unrestricted external callbacks and lack of reentrancy guards still require review.
- **Private-content authorization is implemented.** Owner/subscriber checks, verified payment evidence, server-owned upload provenance, redacted paid reads, and owner-only analytics passed nine isolated HTTP tests. Production schema application and real cloud-storage delivery still need validation; already disclosed external/public URLs cannot be revoked.
- **Old and new chain state are separate.** Existing app users may explicitly register on the new deployment; this does not migrate posts, subscriptions, balances, or proof history. Legacy accounts lacking server-verified registration evidence still require reconciliation.
- **This remains a hybrid app.** Invites, content, files, comments, messaging, moderation, app bonuses, and other state rely on the backend. `registerUser` ignores invite codes; the API enforces admission. New public/exclusive publication is gated by canonical successful receipts, matching wallet calls, registry events and content commitments. Unsigned historical records remain owner-only and do not count as published. Post deletion and unlike are disabled; complete captions and image bytes are not stored on-chain.
- **CHOG admission is enabled; Monad Feet NFT admission is not.** CHOG Genesis ownership is checked at `0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763`. Holders qualify without an invite but still need signed, verified registration, and receive the "ChogNFT holder badge". CHOG-only access depends on continued ownership; independent invite admission remains valid after transfer. Monad Feet NFT mint is coming soon, and dates alone must not activate it.
- **Operational readiness is not established by these tests.** Public RPC capacity, reconciliation, deployment schema application, and real-wallet end-to-end operation still need launch attention. No claim that every existing feature is launch-ready is justified.