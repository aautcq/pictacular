# Pictacular's AWS account (STS trust anchor)

Provisioned per issue #148 / ADR-0006. This is the account every User's
CloudFormation-provisioned IAM Role trusts, and whose credentials
Pictacular's Nitro server uses to call `sts:AssumeRole`.

- **Account ID**: `310649435248`
- **IAM principal**: `pictacular-server` (programmatic access only, inline
  policy granting `sts:AssumeRole` on `*` — tightened once issues #149-152
  fix a Role ARN naming convention to scope this against).
- **Credentials**: stored as `NUXT_AWS_ACCESS_KEY_ID` /
  `NUXT_AWS_SECRET_ACCESS_KEY` in `.env` (see `.env.example`), never
  committed.
- **Verified**: 2026-09-16 — a throwaway Role in a separate AWS
  account, trusting this account with a fixed test External ID, was
  successfully assumed via `sts:AssumeRole` (then deleted).

Rotate the access key periodically via IAM → Users → pictacular-server →
Security credentials; update `NUXT_AWS_ACCESS_KEY_ID` /
`NUXT_AWS_SECRET_ACCESS_KEY` in `.env` (and any deploy secret store)
afterwards.
