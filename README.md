# Monad Feet

Monad Feet is a pnpm workspace containing the React web app, Express API, shared database and API packages, and the Monad contract source.

## Repository contents

- `artifacts/monad-feet/`: React and Vite web app
- `artifacts/api-server/`: Express API
- `contracts/`: Solidity contract source
- `lib/`: shared database, API clients, schemas, and storage libraries
- `scripts/`: workspace utilities
- `docs/`: chain verification notes and launch limitations

## Install

Use Node.js 24 and pnpm. From the repository root:

```sh
pnpm install --frozen-lockfile
```

## Environment

Create a local `.env` file from `.env.example`. Never commit `.env` or paste its values into GitHub.

The API requires `DATABASE_URL` and a strong `SESSION_SECRET`. Object uploads also need compatible object-storage credentials and configuration. The current upload implementation uses Replit-managed object storage, so configure a supported storage provider before running uploads outside Replit. Do not add credentials to this repository.

Set `PORT` for the API server when running it outside Replit. The web app uses Vite's default local development port. Configure the API and web origins together when hosting them separately.

## Checks

```sh
pnpm run typecheck
```

The API and web app can be started in separate terminals:

```sh
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/monad-feet run dev
```

Apply database schema changes only to the intended database after reviewing the migration. The development schema command is:

```sh
pnpm --filter @workspace/db run push
```

## GitHub safety

Review the repository and commit history before making it public. Do not commit private keys, `.env` files, database URLs, wallet seed phrases, session secrets, user exports, or deployment credentials. The contract address and WalletConnect project ID in frontend source are public configuration, not private keys.

## Chain status

See `docs/CHAIN-STATUS.md`. NFT access is not configured. The payment integration checks the supplied contract, treasury, and transaction receipt, but the deployed source has not been independently explorer-verified. Review wallet transactions before signing.

For the full product, architecture, feature, limitation, and next-steps guide, see [`docs/PROJECT_GUIDE.md`](docs/PROJECT_GUIDE.md).