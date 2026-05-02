# Monad Feet

## Overview

An exclusive, invite-only Web3 social media platform for the Monad blockchain community. Users connect via Web3 wallets (Reown AppKit), enter invite codes to join, post content, subscribe to creators, and earn daily streak points toward a future $MFEET airdrop.

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
- **Routing**: wouter
- **UI**: shadcn/ui + lucide-react

## Reown AppKit Config
- Project ID: `19c9787ece0fcd04698c96c998167b4a`
- Network: Monad Testnet (chainId: 10143)
- Login methods: Web3 Wallet, X (Twitter), Email

## Features

1. **Invite Code System** — App is closed. New users need a valid invite code. Every user gets 2 invite codes. Like posts for 5 consecutive days → earn 1 extra invite code.
2. **User Profiles** — Avatar, name, username setup during onboarding.
3. **Wallet Page** — Shows MON + $MFEET balances. Deposit/Withdraw buttons. Invite codes shown here.
4. **Public Feed** — Post content. Like posts (no comments). Cursor-based pagination.
5. **Private Feed** — Creator-exclusive content. Requires active subscription.
6. **Subscription System** — Creators set monthly price. 88% to creator, 12% to platform (tracked on-chain via txHash).
7. **Daily Streak** — Check in daily, earn points (5/10/20 based on streak length). Points count toward future $MFEET airdrop.
8. **Loyalty Badges** — Subscribe to a creator for 2+ consecutive months → NFT loyalty badge on profile.
9. **Leaderboard** — Top users ranked by streak points.

## Initial Invite Codes (for testing)
MONAD00001, MONAD00002, MONAD00003, MONAD00004, MONAD00005, WELCOME2024, TESTINVITE

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)

## Project Structure

```
artifacts/
  api-server/       — Express 5 API server
    src/routes/
      users.ts      — /auth/register, /users/me, /users/:id
      invites.ts    — /invites, /invites/validate
      posts.ts      — /posts CRUD + likes
      subscriptions.ts — /subscriptions, /private-posts, /subscriptions/price
      streak.ts     — /streak, /streak/checkin, /badges
      feed.ts       — /feed/summary, /leaderboard, /wallet/balance
  monad-feet/       — React + Vite frontend
    src/
      context/
        Web3Context.tsx   — Reown AppKit + wagmi setup
        UserContext.tsx   — Current user state
      pages/              — All app pages
lib/
  api-spec/         — OpenAPI spec + Orval codegen config
  api-client-react/ — Generated React Query hooks
  api-zod/          — Generated Zod validation schemas
  db/               — Drizzle ORM schema + client
    src/schema/
      users.ts      — users, invite_codes tables
      posts.ts      — posts, post_likes, private_posts tables
      subscriptions.ts — subscriptions table
      streaks.ts    — streaks, badges tables
```

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
