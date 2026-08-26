# Pictacular

A PWA image gallery: each user connects their own S3 bucket for storage, then uploads,
organizes, and shares photos via albums.

## Language

**User**:
An account holder, identified by email, who owns photos, albums, and (optionally) a Storage
Connection. May sign in with a password or with biometrics.

**Session**:
An authenticated login instance for a User, backed by a JWT access/refresh token pair. A user
may hold several active sessions (e.g. one per device).

**Storage Connection**:
A User's own S3 bucket plus the access Pictacular needs to read and write to it (region, and
whatever AWS grants that access). Every Photo a user owns is stored in their Storage
Connection's bucket, addressed by a storage key. A User has at most one Storage Connection.
_Avoid_: AWS credentials, bucket setup, access key/secret key (see ADR-0006 — no longer how
access is granted)

**Photo**:
A single image file owned by a User, stored in that User's Storage Connection. Tracks its
storage key, MIME type, size, and last-modified time. May belong to zero or more Albums, and may
be liked by other Users.

**Album**:
A named collection of Photos with one owning User (the admin). Has an optional title and
description.

**Album Collaborator**:
A User other than the admin who has been explicitly added to an Album (by email). Collaborators
see the Album from within their own account.
_Avoid_: shared user, member

**Public Share Link**:
A token attached to an Album that grants read-only access to anyone with the URL, without
requiring an account or sign-in.
_Avoid_: share token (as a user-facing term — "token" is the field name, "Public Share Link" is
the concept)

**Biometric Credential**:
A WebAuthn credential (public key + counter) registered for a User's device, used as an
alternative to password sign-in.
_Avoid_: fingerprint, passkey (not yet confirmed as the resurrection algorithm/terminology used)

**Verification**:
The state/process of confirming a User owns the email they registered with, via a one-time
token sent by email. A User is "verified" once confirmed.

**Invitation**:
The flow by which a person without an existing account is added as an Album Collaborator: they
receive an email prompting them to sign up, after which they gain access to that Album.

**Archived Photo**:
A Photo whose underlying S3 object currently has the `GLACIER` or `DEEP_ARCHIVE` storage class,
and so cannot be read (displayed, downloaded) until a Restore Request completes. A bucket's
objects can transition to these classes at any time via a lifecycle rule the User configured
outside Pictacular, independent of how the Photo was originally added (upload vs. import).
_Avoid_: glacier photo, cold photo

**Restore Request**:
A User-initiated action asking AWS to make an Archived Photo's bytes temporarily readable again
for a fixed number of days, after which it automatically becomes an Archived Photo again unless
a new Restore Request is made. At most one Restore Request can be in flight per Photo at a time
(AWS itself rejects a second one); a Restore Request may also be started directly in AWS,
outside Pictacular.
_Avoid_: unarchiving, thawing
