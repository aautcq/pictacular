# Pictacular

Single Nuxt 4 / Nitro app at the repo root (no more `client`/`api` split) for a PWA image
gallery backed by an AWS S3 bucket. Node ~24.19.0, PWA via `@vite-pwa/nuxt`.

## Setup & commands

Install deps from the repo root with `npm install`. The `db:push` script runs
`prisma generate && prisma db push`, so a `NUXT_DATABASE_URL` must be set in `.env` (copy from
`.env.example`) before installing/running.

- `npm run dev` — starts the Nuxt/Nitro dev server on `http://localhost:3000`
- `npm run build` — builds the app (`.output/`)
- `npm run lint` — ESLint with `--fix` (`@antfu/eslint-config` flat config); this is also the
  formatter for `*.{js,ts,vue}`
- `npm run test` — Vitest, using `@nuxt/test-utils` to boot a real instance of the app and
  exercise it over real HTTP/WS requests (the single black-box test seam for this app — no unit
  tests of internal `server/utils`, no mocking of Prisma/S3/JWT internals)

A husky `pre-commit` hook blocks direct commits to `master` and runs `npx lint-staged`
(eslint --fix on `*.{js,ts,vue}`).

## Server architecture (`server/`)

Nitro server routes replace the former NestJS API. Route handlers live under `server/api/**`
(or `server/routes/**`), grouped by the same domain boundaries the old API used (auth, users,
sessions, biometrics, push-subscriptions). Cross-cutting server code lives under
`server/utils/` as plain modules (no DI container) — e.g. `server/utils/prisma.ts` exports a
singleton `PrismaClient`.

Key conventions:

- No `@/*` path alias — server code follows Nitro's own `server/`-relative and auto-import
  conventions.
- Auth is cookie-based JWT: `server/middleware/auth.ts` runs on every request, verifies the JWT
  from the `pictacularAccTok`/`pictacularRefTok` cookies, and writes `event.context.user` /
  `event.context.session`. Protected route handlers call `requireAuth(event)`
  (`server/utils/require-auth.ts`, throws 401 when context is missing), replacing the old
  `AuthGuard`. Silent refresh of an expired access token is not wired up yet.
- `server/utils/jwt.ts` (RS256 sign/verify, `AwsCredentialsTokens` encode/decode) and
  `server/utils/crypto.ts` (password hash/compare, random token generation) are plain modules,
  ported from the former `JwtService`/`CryptoService` without a DI container.
- Cookie names/options are centralized in `server/utils/cookies.ts`
  (`accessTokenCookieOptions`/`refreshTokenCookieOptions`) and reused wherever cookies are
  set/cleared.
- Validation uses `zod` schemas (replacing `class-validator`/`class-transformer`).
- `prisma/schema.prisma` lives at the repo root, uses snake_case DB columns (`@map`) with
  camelCase-free Prisma field names matching snake_case (e.g. `created_at`, `user_id`), and
  explicit `@@map("table_name")` per model. `db:push`/`prisma db push` applies schema
  changes (no migration files are checked in).
- API error responses return a namespaced machine-readable string error code only (e.g.
  `auth.invalid_credentials`); the frontend owns all user-facing translation.

## Client architecture

Nuxt 4's default `srcDir` is `app/` (`server/`, `public/`, and config files stay at the
project root); `app/app.vue` wraps `<NuxtLayout><NuxtPage /></NuxtLayout>` in `@nuxt/ui`'s
`<UApp>`. Standard Nuxt auto-import conventions apply for `app/pages/`, `app/components/`,
`app/composables/`, `app/middleware/`, `app/layouts/`.

Key conventions:

- No global state library (no Pinia/Vuex) — cross-component state lives in plain
  composables backed by `useState` (e.g. `app/composables/usePhotoLibrary.ts`'s
  `photo-library` state), shared across whichever pages/components call that composable.
- UI components come from `@nuxt/ui` (`<UApp>`, etc.); icons via `<Icon name="ph:...">`
  (Phosphor, `@nuxt/icon`).
- Route guards are named middleware under `app/middleware/` (`auth`, `guest`,
  `storage-connection`), applied per-page via `definePageMeta({ middleware: [...] })` rather
  than global middleware, so each page opts into exactly the guards it needs.
- i18n via `@nuxtjs/i18n`; components use a local `useI18n({ useScope: 'local',
  inheritLocale: true })` scope for their own strings plus the `global` scope
  (`useI18n({ useScope: 'global' })`) for shared strings like `common.close` —
  `app/i18n/locales/en.json` holds all translations. The frontend owns translating the
  namespaced error codes the API returns (see Server architecture above) via
  `app/composables/useErrorMessage.ts`.
- `nuxt.config.ts` configures PWA manifest/workbox and `nuxt-security` CSP (must include the
  S3 image host in `img-src` when adding image sources); the dev server runs on Nuxt's
  default `http://localhost:3000`, with no custom host/HTTPS setup needed.

Source of truth for the architectural decisions above:
`docs/adr/0001-nuxt-server-replaces-nestjs-api.md`.
