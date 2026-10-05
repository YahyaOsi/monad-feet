# Monad Feet

## Overview

An exclusive, invite-only Web3 social media platform for the Monad blockchain community. Users connect via Web3 wallets (Reown AppKit), enter invite codes to join, post image-first content, subscribe to creators, earn daily streak points toward a future $MFEET airdrop, and receive real-time notifications.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **Frontend**: React + Vite + Tailwind CSS (artifacts/monad-feet)
- **API framework**: Express 5 (artifacts/api-server)
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Web3**: Reown AppKit + wagmi + viem (Monad Testnet)
- **Image storage**: Google Cloud Storage via Replit Object Storage (presigned URL uploads)
- **Routing**: wouter
- **UI**: shadcn/ui + lucide-react

## Current beta access and launch status
- Creator-approved release mode: publicly hosted, invite-only beta with game and subscription payments active. Keep receipt/session/privacy checks and risk disclosures. Do not pause payments without a new reason or request; NFT access still requires a supplied verified collection.
- Wallet UI uses RainbowKit and Wagmi, with wallet signatures and server-side sessions. Email and social login are disabled.
- Monad Mainnet chain ID is 143. Current platform address: `0x616929D84ED483a26a568fC97A364e5c5eCBe39D`; treasury: `0x23B4C6DdcA73ba99045E1c0Def939BD41932E773`.
- NFT access is disabled. The new collection is planned for 10 October 2026, but the date alone must not enable access. Its address and purchase link are not available yet.
- New users must redeem a valid invite code and start with zero invites. Existing accounts and balances are preserved.
- The creator confirmed on 2026-09-30 that the four existing development accounts are test accounts, not real users needing registration recovery. Leave them unverified; do not manufacture receipts or delete them without authorization.
- New members start with 10 points; daily check-ins award 10 points. Lifetime streak milestones: 2 days = 1 invite + 10 points, 5 days = 1 invite + 50 points, 7 days = 2 invites + 100 points. These milestone awards are separate from the daily check-in.
- Social tasks are explicitly self-reported: four one-time tasks award 5 points each; an X post awards 10 per UTC day and adds one invite if the previous UTC day was also claimed. No extra generic invite points are added to these combined rewards.
- Points are intended for future $MFEET conversion; no conversion ratio or distribution is implemented.
- Member access requires signed wallet authentication and server-verified on-chain registration evidence. A client-provided transaction hash alone must not grant access.
- Paid subscriptions and game payments use the current deployment with runtime-hash and receipt verification. Subscriptions still lack on-chain creator-price enforcement; do not grant private access based only on `isSubscribed`.
- Current contract source: `contracts/MonadFeetV2.sol`. Executable bytecode equivalence was verified (metadata differs), not independently audited. See `docs/contract-verification.md`. Older architecture/deployment notes below are historical, not the source of truth for this deployment.
- Daily game `/daily`: Wash Feet 1.43 MON/5 initial points, Massage Feet 14.3 MON/7, Pedicure 143 MON/15. Each action caps at 10 purchases per UTC day with doubling points. Five lifetime purchases earn an invite event; the server issues usable codes once per verified transaction. Purchases do not advance the separate daily check-in streak. Never silently migrate old chain state.
- See `docs/CHAIN-STATUS.md` for verified chain checks and outstanding launch blockers. Older feature descriptions below describe the original architecture, not a claim that all features are on-chain.

## Features

1. **Invite Code System** — App is closed. New users need a valid invite code. Every user gets 2 invite codes. Like posts for 5 consecutive days → earn 1 extra invite code.
2. **User Profiles** — Avatar, name, username setup during onboarding.
3. **Wallet Page** — Shows MON + $MFEET balances. Deposit/Withdraw buttons. Invite codes shown here.
4. **Image-Centric Posts** — Every post requires an image (mandatory). Caption/text is optional. Images uploaded via Google Cloud Storage (presigned URL). Large image-first card layout.
5. **Private Feed** — Creator-exclusive content. Requires active subscription. Images mandatory.
6. **Subscription System** — Creators set monthly price. 88% to creator, 12% to platform (tracked on-chain via txHash). Notifications sent to creators on new/renewed subscriptions.
7. **Daily Streak** — Check in daily, earn points (5/10/20 based on streak length). Points count toward future $MFEET airdrop.
8. **Loyalty Badges** — Subscribe to a creator for 2+ consecutive months → NFT loyalty badge on profile. Badge notification sent automatically.
9. **Leaderboard** — Three tabs: Points (streak pts → airdrop), Subscribers (creator economy), Engagement (likes + posts × 2).
10. **Notifications** — Bell icon in sidebar with unread badge. Three tabs: All, Unread, Alert Settings. Toggle on/off per type: Likes, Subscriptions, Badges, System. Mark individual or all-read. Auto-polls every 60 seconds.
11. **Monad Smart Contract** — Full Solidity contract at `contracts/MonadFeet.sol`. Stores user registrations, posts (IPFS CID anchoring), on-chain subscriptions with automatic 88/12 MON split, daily streak check-ins, and invite code registry. ABI wired to frontend via `artifacts/monad-feet/src/lib/contract.ts`.

## On-Chain Decentralization (MonadFeet.sol)

The `contracts/MonadFeet.sol` contract implements the full platform on-chain:
- **User Registration**: `registerUser(username, inviteCode)` — stores wallet → username mapping
- **Posts**: `createPost(ipfsCid)` — anchors post content hash on-chain; content stored on IPFS
- **Subscriptions**: `subscribe(creatorAddress)` — payable, splits MON 88/12 automatically on-chain
- **Streak**: `dailyCheckin()` — updates streak and points on-chain
- **Invite codes**: `registerInviteCode(code)` — registers codes on-chain

**To deploy to Monad Mainnet:**
1. Install Foundry: `curl -L https://foundry.paradigm.xyz | bash && foundryup`
2. `forge create --rpc-url https://rpc.monad.xyz --private-key $PRIVATE_KEY contracts/MonadFeet.sol:MonadFeet`
3. Set `VITE_CONTRACT_ADDRESS` env var to the deployed address
4. Frontend contract ABI is already wired in `artifacts/monad-feet/src/lib/contract.ts`

**On-chain post anchoring:**
- After a post is saved to the DB, the frontend fires `writeContract("createPost", postIdentifier)` on Monad mainnet (non-blocking)
- The tx hash is stored in `posts.on_chain_tx_hash` via `PATCH /api/posts/:id/anchor`
- Each post card shows an "On Monad" badge (violet pill) linking to `explorer.monad.xyz/tx/...` if anchored

## Initial Invite Codes (for testing)
MONAD00001, MONAD00002, MONAD00003, MONAD00004, MONAD00005, WELCOME2024, TESTINVITE

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)

## Project Structure

```
contracts/
  MonadFeet.sol             — Full on-chain smart contract (deploy to Monad Testnet)

artifacts/
  api-server/               — Express 5 API server
    src/
      lib/
        objectStorage.ts    — GCS presigned URL service
        objectAcl.ts        — Object access control
      routes/
        users.ts            — /auth/register, /users/me, /users/:id
        invites.ts          — /invites, /invites/validate
        posts.ts            — /posts CRUD + likes + notifications
        subscriptions.ts    — /subscriptions + /private-posts + notifications
        streak.ts           — /streak, /streak/checkin, /badges
        feed.ts             — /feed/summary, /leaderboard (3 sort modes), /wallet/balance
        notifications.ts    — /notifications CRUD + preferences
        storage.ts          — /storage/uploads/request-url, /storage/objects/*

  monad-feet/               — React + Vite frontend
    src/
      context/
        Web3Context.tsx     — Reown AppKit + wagmi setup
        UserContext.tsx     — Current user state
      lib/
        contract.ts         — MonadFeet.sol ABI + contract address
      pages/
        landing.tsx         — Landing / connect wallet
        onboarding.tsx      — 2-step: invite code + profile setup
        feed.tsx            — Image-first public feed + mandatory image upload
        private-feed.tsx    — Creator-locked content
        wallet.tsx          — MON/$MFEET balances + invite codes + streak check-in
        leaderboard.tsx     — 3 tabs: Points / Subscribers / Engagement
        profile.tsx         — User profile + badges + posts
        notifications.tsx   — Notifications list + alert settings (enable/disable per type)
        settings.tsx        — Profile edit + subscription price
      components/
        layout/AppLayout.tsx — Sidebar nav with unread notification badge
        post/PostCard.tsx   — Image-first card (mandatory image at top)

lib/
  api-spec/                 — OpenAPI spec + Orval codegen config
  api-client-react/         — Generated React Query hooks
  api-zod/                  — Generated Zod validation schemas
  db/                       — Drizzle ORM schema + client
    src/schema/
      users.ts              — users, invite_codes tables
      posts.ts              — posts, post_likes, private_posts tables
      subscriptions.ts      — subscriptions table
      streaks.ts            — streaks, badges tables
      notifications.ts      — notifications, notification_preferences tables
  object-storage-web/       — Uppy-based upload client library
```

## DeltaV weekly updates

After a meaningful shipped feature, milestone, real traction, or launch, remind me to post a short, factual weekly update to DeltaV in my voice. Never post without my explicit approval, and post at most once a week. Use `https://deltav.monad.xyz/api/v1/weekly-updates`, with an optional link to an X post. Keep `DELTAV_API_KEY` in Replit Secrets; never commit it or write its value into project files.
