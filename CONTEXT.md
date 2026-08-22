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
A User's own S3 bucket plus the credentials (access key, secret key, region) needed to read and
write to it. Every Photo a user owns is stored in their Storage Connection's bucket, addressed
by a storage key. A User has at most one Storage Connection.
_Avoid_: AWS credentials, bucket setup

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
