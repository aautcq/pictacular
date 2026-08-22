# Legacy features (pictacular-client + pictacular-api)

This is an as-is inventory of every feature found in the old codebases:
`../pictacular-client` (Vue 3 SPA, Pinia, Vite) and `../pictacular-api` (Express, Prisma,
clean/hexagonal architecture). It exists as a reference while rebuilding on the Nuxt 3 app in
this repo — it does **not** imply any of these features will be ported as-is. See `CONTEXT.md`
for the canonical terms used below (e.g. Storage Connection, Album Collaborator, Public Share
Link).

## Authentication & account

- Register with email/password; sends a Verification email.
- Log in with email/password; blocks unverified Users; after 5 incorrect passwords, auto-sends
  a password-reset email (basic brute-force mitigation).
- Resend verification email; verify account via emailed token.
- Send password-reset email; reset password via emailed token.
- Log out (deactivates the current Session); fetch current Session.
- Biometric (WebAuthn) registration and sign-in, as an alternative to password login
  (`fido2-lib`): get registration/assertion options, register a Biometric Credential, verify an
  assertion to open a Session.
- View/update profile: current User info, upload/replace avatar, log out, delete account
  (irreversible).
- Auth cookies (`accessToken`/`refreshToken`); silent refresh: an expired access token is
  reissued from a valid refresh token + still-active Session.

## Storage Connection (per-user S3 bucket)

- Onboarding step (mandatory before using Photos/Albums): submit AWS access key + secret key,
  and either connect an existing bucket or create a new one; sets up bucket CORS.
- Check whether the connected bucket already has images (`check-bucket`).
- Import existing photos from the bucket: walks the bucket, auto-creates Albums from folder
  prefixes, creates Photo records, links them to Albums, and reports progress over a socket.

## Photos

- Personal photo library: timeline view grouped by date, infinite scroll/paging.
- Upload a photo (base64 upload to the User's own bucket), with an upload-progress indicator.
- Select one, many (shift-select), or a whole day's photos.
- Download or delete selected Photos.
- View photo details in a modal, with keyboard-arrow/swipe navigation between photos.
- Like / unlike a photo.
- Add/remove a photo to/from an Album.
- Real-time notification (Socket.IO) when a photo finishes uploading or an avatar updates.

## Albums

- List/create/rename/delete an Album (delete restricted to the admin).
- Search albums by keyword.
- Add an existing Photo to an Album / remove one.
- Add Album Collaborators by email; unknown emails receive an Invitation to sign up.
- Remove an Album Collaborator.
- Generate a Public Share Link (token) for read-only access without an account.
- View an Album via its Public Share Link: title, cover, and photos, but no like/collaborate
  actions.
- Lightweight Album fetch (cover photo + admin info only) for list/summary views.

## Invitation flow

- A person without an account, invited by email to an Album, lands on an invitation screen that
  loads the Album by token, prompts them to sign up, then adds them as an Album Collaborator (or
  resends the invite if they already exist).

## Cross-cutting / infrastructure

- PWA: installable manifest (name/icons/theme), service worker registered via
  `vite-plugin-pwa`, weekly update check.
- Dark mode toggle, persisted to `localStorage`.
- Responsive breakpoints via a `screenSize` composable.
- Global loading skeleton, auto-dismissing alert/toast queue, modal focus-trapping.
- Route guards: `requiresAuth` (redirect to login) and `requiresAwsCredentials` → in new
  vocabulary, "requires Storage Connection" (redirect to onboarding).
- API error logging: every API error is persisted to the DB (`ApiError`: user, IP, path, status,
  message, details).
- Cron keep-warm ping every 14 minutes in production.
- No rate limiting beyond the incorrect-password counter; no image resizing/thumbnailing;
  uploads are base64-in-JSON rather than multipart.

## Data model (old Prisma schema)

- **User**: email, first/last name, avatar_url, password hash, last_sign_in, is_verified,
  verification_token, nb_incorrect_passwords.
- **Session**: active flag, user_agent, belongs to User.
- **Biometrics**: credential_id (unique), pem (public key), counter, belongs to User.
- **AwsCredentials** (→ Storage Connection): bucket, region, tokens; one per User (unique).
- **Photo**: key, mime_type, size, last_modified, owning User; many-to-many with Albums; likes
  many-to-many with Users.
- **Album**: title, description, share_token, admin (User); many-to-many Photos and
  Collaborator Users.
- **AlbumsOnPhotos**: join table with assigned_at.
- **ApiError**: error-logging table (see above).

## Screens / routes (old client)

`/login`, `/profile`, `/verification/:token`, `/reset_password/:token`, `/invitation`,
`/biometrics`, `/aws_credentials`, `/` (photo library), `/public/albums/:token`, `/albums`,
`/albums/:id`, `/albums/new`, `/not-found`.

## Endpoints (old API)

- Auth: `POST /users`, `POST /sessions`, `DELETE /sessions`, `GET /retrieve-session`,
  `POST /send_verification_email`, `POST /verify`, `POST /verify_token`,
  `POST /send_password_reset_email`, `POST /reset_password`.
- User: `GET /me`, `DELETE /me`, `PATCH /me/avatar`.
- Biometrics: `GET /registration_options`, `POST /biometrics`, `GET /assertion_options`,
  `POST /verify_biometrics`.
- Storage Connection: `POST /aws_credentials`.
- Photos: `GET /photos`, `POST /photos`, `POST /photos/import`, `GET /photos/check-bucket`,
  `DELETE /photos/:id`, `PATCH /photos/:photo_id/users/:user_id` (like),
  `DELETE /photos/:photo_id/users/:user_id` (unlike).
- Albums: `GET /albums`, `POST /albums`, `GET /albums/:id`, `GET /albums_light/:id`,
  `GET /albums_by_token/:token`, `GET /search/albums`, `PATCH /albums/:id`,
  `DELETE /albums/:id`, `PATCH /albums/:album_id/photos/:photo_id`,
  `DELETE /albums/:album_id/photos/:photo_id`, `PATCH /albums/:id/share`,
  `PATCH /albums/:id/share_link`, `DELETE /albums/:album_id/users/:user_id`.
- Albums (photos sub-resource): `GET /albums/:album_id/photos`,
  `GET /albums_by_token/:token/photos`.
