# Monad Feet

Monad Feet is a pnpm workspace containing the React web app, Express API, shared database and API packages, and the Monad contract source.

Built by Monad Feet's solo founder/developer. Original project code is available
under the [MIT License](LICENSE). See [third-party attribution](THIRD_PARTY_NOTICES.md)
for libraries, adapted components, fonts, and licensing qualifications.

## Repository contents

- `artifacts/monad-feet/`: React and Vite web app
- `artifacts/api-server/`: Express API
- `contracts/`: Solidity contract source
- `lib/`: shared database, API clients, schemas, and storage libraries
- `scripts/`: workspace utilities
- `docs/`: chain verification notes and launch limitations

## Install

Use Node.js 24, pnpm 10, and a PostgreSQL database that you own and can safely
use for development. From a fresh checkout:

```sh
git clone https://github.com/YahyaOsi/monad-feet.git
cd monad-feet
pnpm install --frozen-lockfile
```

## Environment

Create a local `.env` file from `.env.example`. Never commit `.env` or paste its values into GitHub.

The API requires `DATABASE_URL` and a strong `SESSION_SECRET`. Object uploads also need compatible object-storage credentials and configuration. The current upload implementation uses Replit-managed object storage, so configure a supported storage provider before running uploads outside Replit. Do not add credentials to this repository.

Never use the production database for initial setup. This repository intentionally
does not include credentials, member records, or uploaded private media.

## Database and local development

Copy the environment template and edit the copy with your own development values:

```sh
cp .env.example .env
```

The commands below assume a POSIX-compatible shell and a shell-compatible `.env`
file. The development scripts do not automatically load the root `.env`.

```sh
# Load your local configuration in each terminal that needs it.
set -a
. ./.env
set +a

# Review the schema before applying it to your development database.
pnpm --filter @workspace/db run push

# Terminal 1: API
PORT=8080 pnpm --filter @workspace/api-server run dev
```

In another terminal, load `.env` in the same way and start the frontend:

```sh
PORT=5173 BASE_PATH=/ pnpm --filter @workspace/monad-feet run dev
```

Both `PORT` and `BASE_PATH` are required by the Vite configuration. Verify API
liveness at `http://localhost:8080/api/healthz`.

The browser uses same-origin `/api` requests and `/api/ws` WebSockets. The Vite
configuration does **not** proxy these to the API by default. Outside the managed
workspace routing, place a reverse proxy in front of both services. For example,
if you have [Caddy](https://caddyserver.com/) installed, save the following as a
local `Caddyfile`, run `caddy run`, and open `http://localhost:3000`:

```caddyfile
http://localhost:3000 {
    handle /api {
        reverse_proxy localhost:8080
    }
    handle /api/* {
        reverse_proxy localhost:8080
    }
    handle {
        reverse_proxy localhost:5173
    }
}
```

Do not bypass same-origin routing by introducing broad CORS or insecure cookie
settings. Replit-managed object uploads require its storage credential sidecar;
they will not work on a plain local machine solely by filling in directory
variables. To use uploads elsewhere, adapt the storage client and configure
your provider's authentication. Wallet signing also requires a supported wallet
and connectivity to Monad mainnet; use caution with real funds.

## Checks and builds

```sh
pnpm run typecheck
pnpm --filter @workspace/api-spec run codegen
pnpm --filter @workspace/api-server run build
PORT=5173 BASE_PATH=/ pnpm --filter @workspace/monad-feet run build
```

Regenerate API clients only after intentionally changing `lib/api-spec/openapi.yaml`.
Database-backed test commands require an isolated test database, not production.
See [`scripts/testing/README.md`](scripts/testing/README.md).

## Managed workspace development

The registered app and API services provide their own routing and port settings.
Their development commands are:

```sh
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/monad-feet run dev
```

## Build history

The existing repository history is preserved. Review dated commits with:

```sh
git log --all --date=iso-strict --format='%h %ad %s'
```

The history includes original development and later source synchronization
commits. A synchronization commit is not a claim that all imported code was first
written on that date. Event build-window eligibility must be checked against the
organizer's actual start/end dates and any rules about pre-existing work. No
commits should be fabricated, backdated, or rewritten to imply eligibility.

## GitHub safety

Review the repository and commit history before making it public. Do not commit private keys, `.env` files, database URLs, wallet seed phrases, session secrets, user exports, or deployment credentials. The contract address and WalletConnect project ID in frontend source are public configuration, not private keys.

## Chain status

See `docs/CHAIN-STATUS.md`. NFT access is not configured. The payment integration checks the supplied contract, treasury, and transaction receipt, but the deployed source has not been independently explorer-verified. Review wallet transactions before signing.

For the full product, architecture, feature, limitation, and next-steps guide, see [`docs/PROJECT_GUIDE.md`](docs/PROJECT_GUIDE.md).