# Generic OAuthAccount table, with auto-linking by verified email

Adding Google sign-in/registration, we considered a Google-specific column on `User` (e.g.
`google_id`) versus a generic `OAuthAccount` table keyed by provider + provider-user-id. We
chose the generic table: "a User can authenticate via more than one external identity
provider" is a recurring concept (Apple/GitHub are likely follow-ups), and retrofitting it
once real Google-linked rows exist is far more costly than modeling it generically now, even
though Google is the only provider today. `OAuthAccount` stores only the identity (provider,
provider_user_id, linked email) — Google's access/refresh tokens are used transiently to
verify identity during the callback and are never persisted, since nothing in Pictacular's
domain currently calls back out to Google APIs.

Alongside this, `User.password` becomes nullable (an OAuth-only User has no password), and
sign-in auto-links an OAuth Account to an existing User by matching email: a verified match
links immediately; an unverified match links *and* flips the User to verified, on the
reasoning that Google has just proven ownership of that email, which is exactly what
Pictacular's own Verification exists to establish. This is a deliberate trust decision — it
means an unverified signup can be silently claimed by whoever first proves that email via
Google — accepted because email ownership is the one identity Pictacular already treats as
authoritative for a User.
