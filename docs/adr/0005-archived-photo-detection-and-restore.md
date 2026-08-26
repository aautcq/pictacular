---
status: accepted
---

# Detecting Archived Photos and restoring them via per-object RestoreObject calls

A Storage Connection's bucket is the User's own — a lifecycle rule they configure outside
Pictacular can transition any object (uploaded or imported) to the `GLACIER` or `DEEP_ARCHIVE`
storage class at any time, after which `GetObject` fails with `InvalidObjectState` until the
object is restored. We treat only these two storage classes as an Archived Photo; `GLACIER_IR`
and Intelligent-Tiering's archive tiers are real S3 states too, but the former reads instantly
(no restore needed) and the latter isn't visible on the free `ListObjectsV2` `StorageClass`
field (it would need a `HeadObject` per object to detect) — both deliberately out of scope for
now.

Detection reuses the existing Nitro scheduled-task pattern (`server/tasks/email-outbox`): a
periodic job re-lists each connected bucket and persists `storage_class` on the `Photo` row from
that free field, then `HeadObject`s any Archived Photo to also capture restore status. Polling
rather than reacting per-request avoids an AWS round trip on every gallery load, and a 15-30 min
interval is more than adequate since a restore itself takes hours.

Restoring is user-initiated only (per-photo or "restore all"), always via the Standard retrieval
tier, and implemented as a plain loop over `RestoreObjectCommand` — not S3 Batch Operations,
which would require the User to provision an Inventory report, manifest, and IAM role in their
own AWS account just to unlock a handful of photos. Before each `RestoreObjectCommand` call we
`HeadObject` first and skip the call if a restore is already in-flight or still unexpired: AWS
itself rejects a second concurrent restore with a 409 `RestoreAlreadyInProgress`, and a restore
may already have been started directly in the AWS console rather than through Pictacular.

A completed restore is always temporary — AWS deletes the temporary copy after the requested
number of days and the object silently reverts to being an Archived Photo. We deliberately never
auto-copy the object to `STANDARD` to make it permanent, since that would add ongoing storage
cost to the User's bill without explicit opt-in; instead we track the restore's expiry and
re-warn the User as it approaches, consistent with the read-only relationship Pictacular has to
a User's own bucket otherwise (see ADR 0001).
