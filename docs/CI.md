# GitHub Actions setup

## Current status

The type checks, 123 fixture tests, documentation checks, and production builds
have passed in the existing development workspace. Hosted GitHub Actions has
not been claimed as passing or enabled.

The connected integration can update normal source files but returned HTTP 404
when asked to create `.github/workflows/ci.yml`, including through GitHub's SDK.
The underlying workflow-write permission/restriction has not been established.

The complete workflow is available as a
[reviewable template](ci/repository-checks.yml). It uses Node 24, pnpm 10.26.1,
the frozen lockfile, read-only job permissions, and no production secrets.

## Activate it

Using a GitHub account with permission to create repository workflows:

1. Open [the new workflow file editor](https://github.com/YahyaOsi/monad-feet/new/main?filename=.github%2Fworkflows%2Fci.yml).
2. Copy the full [workflow template](ci/repository-checks.yml) into that file.
3. Commit it as `.github/workflows/ci.yml`.
4. Open [GitHub Actions](https://github.com/YahyaOsi/monad-feet/actions).
5. Confirm the run completes before treating it as passing CI. If Actions
   requires repository-owner approval, review and approve it through GitHub.

Do not place production credentials, private wallet keys, or the application
database URL in this workflow. The fixture runner supplies a deliberately
unreachable local database endpoint for helpers that construct pools on import.

After activation, the optional status badge URL is:

```text
https://github.com/YahyaOsi/monad-feet/actions/workflows/ci.yml/badge.svg
```

Do not add a badge implying successful checks before the real workflow exists.
For independent fresh-checkout testing, see the separately tracked verification
work; this guide does not claim that review has been completed.
