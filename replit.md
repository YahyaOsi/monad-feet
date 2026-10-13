# Monad Feet

## Overview

An exclusive Web3 social media platform for the Monad blockchain community. Users connect via Web3 wallets (RainbowKit and Wagmi), join with an invite code or verified CHOG Genesis ownership, publish image-first content with confirmed Monad transactions, subscribe to creators, earn app points, and receive real-time notifications. Points are not tokens; future token plans or rewards have no guaranteed eligibility, date, value or conversion rate.

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

## Current access and launch status
- Beta ended on October 10, 2026. The community remains membership-gated, not open registration. Existing game and subscription payment settings remain creator-approved; keep receipt/session/privacy checks and risk disclosures. Do not pause or expand payments without a new reason or request.
- Wallet UI uses RainbowKit and Wagmi, with wallet signatures and server-side sessions. Email and social login are disabled.
- Monad Mainnet chain ID is 143. Current platform address: `0x616929D84ED483a26a568fC97A364e5c5eCBe39D`; treasury: `0x23B4C6DdcA73ba99045E1c0Def939BD41932E773`.
- CHOG Genesis holders can qualify for invite-free admission after a live ownership check of `0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763`, followed by signed, receipt-verified registration. Existing and new holders receive the exact label "ChogNFT holder badge". CHOG-only access depends on current ownership; transferring the NFT does not revoke independently earned invite admission.
- Monad Feet NFT admission is unavailable; mint is coming soon. A launch date alone must not enable it.
- New users must redeem a valid invite code or qualify through CHOG ownership and start with zero invites. Existing accounts and balances are preserved.
- The creator confirmed on 2026-09-30 that the four existing development accounts are test accounts, not real users needing registration recovery. Leave them unverified; do not manufacture receipts or delete them without authorization.
- New members start with 10 points; daily check-ins award 10 points. Lifetime streak milestones: 2 days = 1 invite + 10 points, 5 days = 1 invite + 50 points, 7 days = 2 invites + 100 points. These milestone awards are separate from the daily check-in.
- Social tasks are explicitly self-reported: four one-time tasks award 5 points each; an X post awards 10 per UTC day and adds one invite if the previous UTC day was also claimed. No extra generic invite points are added to these combined rewards.
- Points measure current app activities, not tokens or confirmed rewards. Potential future $MFEET plans do not guarantee conversion, eligibility, distribution, dates or rates.
- Member access requires signed wallet authentication and server-verified on-chain registration evidence. A client-provided transaction hash alone must not grant access.
- New public and exclusive posts require successful, canonical Monad publication evidence before visibility. No user or admin post deletion and no unlike are supported. Preserve unsigned historical records privately for their authors; exclude them from published counts. The registry stores authorship and a content commitment, not complete captions or image bytes.
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
