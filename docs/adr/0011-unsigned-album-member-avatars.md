# Album member avatars are passed through unsigned, not per-member signed

`User.avatar_url` is normally a private S3 object key, only ever turned into a viewable URL by
`serializeUser` signing it with *that same User's own* `aws_credentials` — a shape that only
makes sense for a User viewing their own profile (login, GET /me, avatar upload).

Showing collaborator avatars on an Album (`AlbumMember`, via `memberSelect`) needed a value
another User's browser can actually load. Rather than have the server presign each member's
avatar with their own credentials on every Album read (an extra query + S3 presign call per
member, and a new place other Users' `aws_credentials` get touched server-side), we expose
`avatar_url` on `AlbumMember` as-is, unsigned, straight from the column.

This means a real S3-key avatar (uploaded via `PATCH /me/avatar`) will not render correctly as
someone else's collaborator avatar yet — only externally-hosted URLs (e.g. the seeded
pravatar.cc placeholders) display correctly today. Revisit this (likely via per-member signing,
or moving avatars to a public storage path entirely) if/when real uploaded avatars need to be
visible to other Album members.
