# Cross-account IAM Role replaces user-supplied AWS keys for Storage Connections

Storage Connection onboarding previously required a User to hand-create an IAM user in their
own AWS account and paste its access key + secret key into Pictacular. We considered three
ways to automate this (issue #146): a CloudFormation quick-launch that still ends in copying
generated keys, a locally-run CLI/script that POSTs keys back to Pictacular, and a
cross-account IAM Role assumed via STS. We chose the Role: a User launches a CloudFormation
stack once, in their own AWS Console, that creates an IAM Role trusting Pictacular's AWS
account (scoped with a fixed, per-connection External ID) instead of an IAM user with keys.
Pictacular calls `sts:AssumeRole` to obtain short-lived credentials on demand. This is the only
onboarding mechanism now — the manual key-pair form is removed, not kept as a fallback, so no
long-lived AWS secret ever exists on Pictacular's side. This requires Pictacular to operate its
own AWS account as the STS trust anchor, and changes what a Storage Connection stores: a Role
ARN + External ID instead of an access/secret key pair. A dead/revoked Role is only detected
reactively (the next real operation that needs the bucket), which then hard-blocks all photo
actions until the User reconnects.
