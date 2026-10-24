# Contributing to Monad Feet

Monad Feet is maintained by its solo founder/developer. Contributions are
welcome, but a contribution is not a promise of employment, payment, points,
token allocation, or any other reward.

## Before making a change

1. Follow the [setup guide](README.md#install).
2. Read the [architecture](docs/ARCHITECTURE.md) and relevant feature code.
3. Open an issue describing the problem and proposed scope for substantial work.
4. Work on a branch and keep pull requests focused.

Keep Monad Feet on Monad and preserve the existing social and creator product.
Do not replace the database, wallet stack, or payment contracts as part of an
unrelated fix.

## Checks

Run from the repository root:

```sh
pnpm run typecheck
pnpm run test:unit
pnpm run check:docs
pnpm --filter @workspace/api-server run build
PORT=5173 BASE_PATH=/ pnpm --filter @workspace/monad-feet run build
```

The fixture-based suite requires no funded wallet or database. Database tests
are separate; use an isolated disposable database and follow the safety notes
in the test source. Never run fixtures against production.

For API changes, update `lib/api-spec/openapi.yaml`, regenerate the client with
`pnpm --filter @workspace/api-spec run codegen`, and include the generated changes.
Verify the client request, server response, cache update, and UI error states.

## Pull request checklist

- Explain the user-visible problem and the change.
- State how you verified it and what remains unverified.
- Include screenshots for interface changes without exposing private content.
- Add regression tests where practical.
- Preserve attribution for copied or adapted code.
- Do not commit credentials, user exports, `.env`, database dumps, conversation
  uploads, local agent state, or build outputs.
- Do not bypass wallet authentication, content privacy, or receipt validation.
- Do not describe mocked wallet results as real signing or payment settlement.

Public issues are suitable for ordinary bugs, not sensitive vulnerabilities.
See the [security reporting policy](SECURITY.md) for sensitive reports.
