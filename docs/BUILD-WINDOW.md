# Reviewer guide and build-window evidence

This guide maps the requested repository checklist to verifiable files and
public history. It distinguishes original development, source synchronization,
and later maintenance. It does not certify competition eligibility.

## Event reference

The official **Monad Metropolis** page describes a six-week build window from
**September 1 to October 13, 2026**, followed by judging from October 14 to 27.

- [Official event page and key dates](https://monad.xyz/developers/hackathons/metropolis)
- [Official application platform](https://hackathon.monad.xyz/)

The public event FAQ says existing projects may participate if the submitted
work is new work built during the six weeks. It also says open sourcing is
encouraged but not required, while judges must be able to verify the work.

The repository has nevertheless been prepared against the stricter public
repository checklist supplied by the founder: complete source, setup
instructions, an open source license, attribution, and build-window history.
That supplied checklist should not be represented as a verbatim quotation of
the public FAQ.

Metropolis is the event reference researched for this review; this guide does
not establish which program the founder registered for. The application
platform requires sign-in, so account-specific rules, submission status,
deadline extensions, and accepted submission revisions have not been verified.
Where a registered program has different rules, its official terms control.

## Repository checklist

| Requirement | Evidence | Qualification |
| --- | --- | --- |
| Public GitHub repository | [YahyaOsi/monad-feet](https://github.com/YahyaOsi/monad-feet) | Public visibility checked October 24, 2026 |
| Complete application source | `artifacts/monad-feet`, `artifacts/api-server`, `contracts`, `lib`, `scripts`, and workspace configuration | Includes frontend, API, contracts, schemas, clients, and tests; excludes secrets, private data, conversation uploads, and local agent state |
| Setup instructions | [README](../README.md) and [environment template](../.env.example) | Documents database setup, required ports/base path, same-origin routing, storage limitations, and builds |
| Open source license | [MIT License](../LICENSE) | Applies to original project code; third-party terms remain applicable |
| Clear external attribution | [Third-party notices](../THIRD_PARTY_NOTICES.md) | Includes dependencies, adapted UI, fonts, and undeclared-license qualifications; not a complete transitive legal audit |
| History during the window | October 5 and October 13 public source-sync commits below | Genuine in-window repository snapshots, not a reconstructed daily development history |

## Public source snapshots

The repository predates the event. Earlier code must not be described as
entirely created during the event window.

| Date / UTC | Public commit | Meaning |
| --- | --- | --- |
| May 3, 2026 | [`26c946e`](https://github.com/YahyaOsi/monad-feet/commit/26c946e6d4d5e591ee96266aa5cfc5d7d7af7c37) | Last public development commit immediately before the October source synchronizations; pre-existing work |
| October 5, 2026, 06:02:46 | [`d836794`](https://github.com/YahyaOsi/monad-feet/commit/d8367946de317be5b300c7942d424785df907e0f) | Source synchronization for hackathon review, within the published calendar-date window |
| October 13, 2026, 05:01:04 | [`66844fb`](https://github.com/YahyaOsi/monad-feet/commit/66844fb57801066051994fc7570be0dd00e42921) | Latest public source snapshot dated within that window |

Both author and committer timestamps on the two October synchronization
commits were checked. A source synchronization timestamp records when code
entered this repository; it does not independently establish when every line
was authored or first published elsewhere.

### Review the changes

- [Pre-existing public baseline to October 13 snapshot](https://github.com/YahyaOsi/monad-feet/compare/26c946e6d4d5e591ee96266aa5cfc5d7d7af7c37...66844fb57801066051994fc7570be0dd00e42921)
- [October 5 to October 13 changes](https://github.com/YahyaOsi/monad-feet/compare/d8367946de317be5b300c7942d424785df907e0f...66844fb57801066051994fc7570be0dd00e42921)
- [Browse the October 13 source tree](https://github.com/YahyaOsi/monad-feet/tree/66844fb57801066051994fc7570be0dd00e42921)

The October 5 to October 13 comparison contains 107 changed files, including
API and frontend changes, shared API/schema updates, database schema changes,
tests, and documentation. File counts measure repository changes, not users,
product adoption, or independently audited features.

For a local review without changing the checked-out branch:

```sh
git log --date=iso-strict \
  --since='2026-09-01T00:00:00Z' \
  --until='2026-10-14T00:00:00Z' \
  --format='%h %ad %s'

git diff --stat \
  d8367946de317be5b300c7942d424785df907e0f \
  66844fb57801066051994fc7570be0dd00e42921
```

These commands use calendar dates in UTC for inspection. They do not override
an organizer's exact deadline, time zone, or submission rules.

## Post-window maintenance

Current `main` is not the same as the October 13 snapshot.

- Backpack wallet integration was published to the app after the build window
  and synchronized to GitHub on October 24.
- The root MIT license, attribution inventory, and expanded setup instructions
  were added on October 24.
- This reviewer guide and README refinements are also post-window documentation.

These updates improve the current repository. They must not be presented as
evidence that those same changes were available before the event deadline.
Use the October 13 snapshot when the review must be limited to in-window code.

## Review limitations

The preserved history supports inspection of dated snapshots and real diffs.
Whether two source-sync commits provide enough build evidence, whether
pre-existing work is eligible, and whether later documentation is accepted are
decisions for the organizer. No history has been fabricated, backdated, force
pushed, or replaced to imply eligibility.

The official event page confirms a schedule and public FAQ, not the founder's
registration or a successful submission. No eligibility approval, deadline
extension, security audit, payment audit, or review outcome is claimed.
