# Security policy

## Reporting a vulnerability

Do not publish an exploit, private content, wallet information, credentials,
or user data in a public issue or pull request.

If GitHub displays a **Report a vulnerability** option in this repository's
Security tab, use it. That feature is not assumed to be enabled.
Otherwise, contact the maintainer through the project's official
[X account](https://x.com/MonadFeet) to arrange a private reporting channel
before sending sensitive details.

Provide the affected version or commit, a concise description, potential
impact, and safe reproduction steps using accounts and data you control.
Do not include keys, seed phrases, session cookies, or private member data.

## Safe testing boundaries

- Do not test against other users' accounts or subscriber content.
- Do not send funds or execute mainnet actions to demonstrate a report.
- Do not perform disruptive scanning, denial-of-service, social engineering,
  or destructive database operations.
- Use isolated fixtures or your own disposable test environment.

This policy is not authorization to attack a deployed service and does not
establish a bug bounty, payment promise, response SLA, or legal safe harbor.

## Maintenance and assurance

The actively maintained source is the current `main` branch; no historical
release has a guaranteed security support period. Historical hackathon
snapshots remain available for review, not as a recommendation for deployment.

Automated checks and source review do not establish that the application or
contracts are audited. A test passing with a mocked provider is not proof of
successful real-wallet authentication, payment settlement, or reward delivery.
See [verification boundaries](docs/VERIFICATION.md).
