# Verification and known limitations

This document distinguishes reproducible checks from claims that require
real accounts, an isolated database, a wallet, or independent review.

## Local verification record

Checked on October 24, 2026 in the existing development workspace:

| Check | Result |
| --- | --- |
| Full workspace TypeScript check | Passed |
| Allowlisted fixture tests | 123 passed, 0 failed, 0 skipped |
| Documentation check | Passed: relative links, fenced code blocks, and root license presence |
| API production build | Passed |
| Web production build | Passed, with dependency sourcemap/annotation and large-chunk warnings |
| Component sandbox build | Passed |
| Signed-out landing page | Captured from the running development preview |

This record is not a fresh-install test, a GitHub-hosted runner result,
a payment audit, or proof of deadline-era behavior. Consult GitHub Actions
for the actual hosted CI status.

## Reproducible repository checks

```sh
pnpm run typecheck
pnpm run test:unit
pnpm run check:docs
pnpm --filter @workspace/api-server run build
PORT=5173 BASE_PATH=/ pnpm --filter @workspace/monad-feet run build
PORT=5174 BASE_PATH=/__mockup/ pnpm --filter @workspace/mockup-sandbox run build
```

The [workflow template](ci/repository-checks.yml) is configured to run these
checks on pushes to `main` and pull requests, with read-only repository permissions
and without production secrets. It is not active in the public repository yet:
the connected integration rejected writing `.github/workflows/ci.yml`.
See [activation instructions](CI.md). A template is not a hosted CI result.

## What the fixture suite checks

The explicit allowlist in
[`scripts/testing/run-unit-tests.mjs`](../scripts/testing/run-unit-tests.mjs)
covers existing tests for:

- Wallet challenge rules and rejection cases.
- Registration receipt parsing and in-memory registration route behavior.
- Publication evidence and recovery with mocked chain responses.
- Reward calculations and receipt rejection cases.
- Frontend registration/subscription recovery state.
- Notification/query invalidation rules and social UI state.
- Shared-link routing and current product disclosures.
- Optional analytics consent and data-minimization behavior.
- Request-capacity controls and structural privacy requirements.

The runner removes session credentials and replaces any database URL with a
deliberately unreachable, credential-free localhost endpoint. Some helpers
construct lazy database pools on import; an unexpected query must fail rather
than touch a real database. It disables database tests and intentionally excludes
database-backed suites.
Adding a new file to the suite requires reviewing its dependencies and side
effects; tests are not automatically discovered.

## What passing checks do not prove

| Evidence | Does not establish |
| --- | --- |
| Type checking and builds | Every real member journey works |
| Mocked provider/receipt tests | Real signing, transaction inclusion, payment settlement, or contract safety |
| In-memory route tests | Full production database behavior |
| Structural privacy tests | A complete privacy or security audit |
| Signed-out screenshot | Membership, private content, or payment behavior |
| Live deployment metadata | Successful real-wallet or production data verification |
| Source and ABI in the repo | Deployed bytecode/source equivalence or an independent audit |

## Separate verification needed

- Fresh-checkout setup outside the managed workspace, including the documented
  storage and routing requirements.
- Database integration tests in a disposable isolated environment.
- Real wallet authentication and interrupted-action recovery across supported
  wallets and devices.
- Actual payment settlement and reward delivery, where authorized.
- Full review of third-party redistribution terms, including packages with
  missing license metadata.

These checks must not use production data casually or be replaced by optimistic
UI states. Paid subscriptions being described as live is based on the founder's
confirmation, not an independent payment audit.

## Safety and reporting

Follow [SECURITY.md](../SECURITY.md) for sensitive reports and
[CONTRIBUTING.md](../CONTRIBUTING.md) for code changes.
For deadline/version distinctions, see [build-window evidence](BUILD-WINDOW.md).
