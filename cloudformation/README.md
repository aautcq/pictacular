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

Every parameter (`ExternalId`, `AllowedOrigin`, and — for `create-bucket.yaml` — `BucketName`/
`RoleName`) is meant to be pre-filled by Pictacular via the Launch Stack URL's query string
(`...&param_ExternalId=...&param_BucketName=...`) when it builds the "Connect your storage"
link — a User launching the stack never has to type any of them by hand, nor paste anything
back out of the AWS Console afterwards: Pictacular already knows the bucket name/Role ARN it
asked CloudFormation to create (see `server/api/storage-connections/launch.post.ts`), and
confirms the stack has finished via a direct `sts:AssumeRole` call rather than querying
CloudFormation's own stack Outputs.

Linted in CI (`.github/workflows/cfn-lint.yml`) with
[`cfn-lint`](https://github.com/aws-cloudformation/cfn-lint) on every change under this
directory. Template *contents* aren't exercised by this app's Vitest suite (a Vitest black-box
test can't meaningfully assert on CloudFormation resources/policies) — `cfn-lint` plus a manual
launch in a real/sandbox AWS account is the validation path instead.
