# Testing

## Repeatable repository checks

From the repository root:

```sh
pnpm run typecheck
pnpm run test:unit
pnpm run check:docs
```

`test:unit` runs the explicit allowlist in
[`run-unit-tests.mjs`](run-unit-tests.mjs), with the database URL replaced by an
unreachable credential-free localhost endpoint and database integration tests
disabled. It uses the existing `tsx` dependency
and Node's test runner. No funded wallet is required.

See [verification boundaries](../../docs/VERIFICATION.md) for what these checks
do and do not establish. Database suites are separate and require an isolated
disposable database; never aim them at production.

## Isolated wallet UI fixtures

These files are test-only. Never import them into the application, publish them as app assets, or install an authentication bypass.

- `monad-feet-browser-wallet.js`: inject with Playwright `page.addInitScript` before navigating. It provides an injected/EIP-6963 wallet with a fixture identity, deliberately invalid signature responses, and rejects transaction submissions.
- `monad-feet-fixtures.mjs`: import `installMonadFeetFixtures(context, origin)` into a Node-based Playwright test and call it before navigation. It mocks authentication and app APIs. Inspect its returned state to control reward-verification outcomes.

Use them together. Fixture signatures must never be sent to the real authentication API. Do not substitute a real wallet key or a funded address.

These test user-interface behavior only, not cryptographic authentication, contract execution, payment settlement, or real database authorization. Keep mocked UI results separate from backend and chain evidence.

The fixture action fees are 1.43/14.3/143 MON, initial points 5/7/15, and daily limits ten each.