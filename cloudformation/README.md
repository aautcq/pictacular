# CloudFormation templates

Version-controlled templates Pictacular's onboarding flow sends Users to launch in their own
AWS Console (issue #146 / ADR-0006), replacing the old manual access-key-pair paste. Each
template provisions an IAM Role that trusts Pictacular's own AWS account (the STS trust anchor
provisioned in issue #148, see `docs/aws-account-setup.md`), scoped to a fixed per-connection
External ID, so Pictacular can call `sts:AssumeRole` and operate on the User's bucket without
ever handling a long-lived access key.

- `create-bucket.yaml` — "create a new bucket" mode (issue #149): provisions a brand-new
  private bucket (with Pictacular's required CORS rule) alongside the Role.
- `connect-bucket.yaml` — "connect an existing bucket" mode (issue #151, not yet built): applies
  the Role + CORS rule to a bucket the User already owns, named as a stack parameter.

Both parameters `ExternalId` and `AllowedOrigin` are meant to be pre-filled by Pictacular via
the Launch Stack URL's query string (`...&param_ExternalId=...&param_AllowedOrigin=...`) when
it builds the "Connect your storage" link — a User launching the stack never has to type
either value by hand.

Linted in CI (`.github/workflows/cfn-lint.yml`) with
[`cfn-lint`](https://github.com/aws-cloudformation/cfn-lint) on every change under this
directory. Template *contents* aren't exercised by this app's Vitest suite (a Vitest black-box
test can't meaningfully assert on CloudFormation resources/policies) — `cfn-lint` plus a manual
launch in a real/sandbox AWS account is the validation path instead.
