# Judge walkthrough

## Product in one sentence

Monad Feet is a wallet-based social and creator community on Monad where
members share posts, support creators through subscriptions, and participate
in community activities.

**Live app:** [monadfeet.social](https://monadfeet.social)

This URL was obtained from the active deployment metadata. Live availability
and successful build metadata are not evidence of a complete user-journey audit.

## Choose the correct version

- Review [build-window evidence](BUILD-WINDOW.md) for the October 13 source
  snapshot and in-window diffs.
- Current `main` and the live app include later maintenance.
- In particular, Backpack support and repository/CI improvements are
  post-window changes. Do not include them as in-window achievements.

## A focused three-minute demonstration

| Time | Show | Explain |
| --- | --- | --- |
| 0:00–0:30 | Landing page and public docs | A creator community combining social activity, wallet identity, and subscriptions |
| 0:30–1:00 | Wallet connection and an existing authorized member session | Membership and identity are distinct from merely connecting a provider |
| 1:00–1:40 | Feed, a member profile, and an already published post | A real publication has verified transaction evidence; text/media remain off chain |
| 1:40–2:15 | Creator subscription interface and permitted subscriber content | Members can support creators; private media is subject to server-side access checks |
| 2:15–2:40 | Notifications, community activities, and points | App engagement features are live product functionality, not promises of token value |
| 2:40–3:00 | Source, architecture, and verification notes | Show implementation depth and honestly identify unverified real-wallet or payment paths |

Use accounts and content you control. Do not expose private messages,
subscriber content from another creator, real wallet balances, or member data.

## Access preparation

The landing page and docs can be reviewed without joining. Full member flows
need a valid existing account, a valid one-use invite, or verified ownership
of a qualifying CHOG Genesis NFT. The planned Monad Feet NFT collection is not
an active admission option.

Arrange a private reviewer invite before presenting if needed. Do not commit
invite codes or real credentials to the repository. A consumed invite cannot
be reused by another judge.

Have the presenter connect their own authorized session before a short
presentation. Never ask a judge to enter a seed phrase or fund a wallet
simply to watch the demo.

## Transaction demonstrations

Prefer an existing confirmed action and its explorer evidence for the brief
walkthrough. Starting a new mainnet action may create permanent records,
consume funds, or take longer than the demo.

Only perform a new transaction with informed approval from the wallet owner.
Do not auto-sign, promise reversibility, or describe a fixture as a real
settlement. Published posts and likes are intended to be permanent.

If a wallet prompt is rejected or a request is interrupted, show the actual
status and recovery behavior. Do not replace it with a fake success.

## If membership access or wallet availability blocks the demo

Show the public documentation, relevant source code, fixture-test output, and
the limitations in [verification](VERIFICATION.md). Clearly label fixture
behavior and do not introduce an authentication bypass.

## Submission assets

The repository includes a current signed-out development-preview screenshot
in [the README](../README.md). It is not a deadline-era screenshot or proof
of a logged-in/payment flow.

A final recorded demo and account-specific submission confirmation are not
included or claimed by this guide. A recording should show the real product
and disclose its version and date.
