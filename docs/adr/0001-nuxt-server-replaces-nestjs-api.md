# Replace the NestJS API with the Nuxt/Nitro server, collapse the monorepo

Status: accepted

The `api/` (NestJS) and `client/` (Nuxt) split added two deploy targets, two
config systems, and duplicated concerns (env vars, i18n, auth) for an app
small enough not to need that separation. We're replacing `api/` entirely
with Nuxt/Nitro server routes and flattening the pnpm-workspace monorepo into
a single app at the repo root, as a big-bang migration (not incremental) —
the app is still bootstrap-stage on the client side, so there's little
in-flight work to strand. Prisma is kept, relocated to a root
`prisma/schema.prisma` with a `server/utils/prisma.ts` client singleton
(standard Nitro+Prisma convention).

## Consequences

- **Real-time**: the Socket.IO gateway is rewritten on Nitro's native
  WebSocket support (`defineWebSocketHandler`); the client drops
  `socket.io-client` for the native `WebSocket` API. Nitro's WS layer isn't
  Socket.IO-wire-compatible, so this is a rewrite, not a lift-and-shift.
  The `nitropack` version Nuxt 3.8.2 resolves by default (2.8.0) predates
  crossws-based WS support entirely; a `pnpm.overrides` pin (`~2.10.4`,
  still within Nuxt's `^2.8.0` peer range) is used to get a `nitropack`
  build that bundles a `crossws` adapter wiring `server.on('upgrade', ...)`.
- **Keep-alive cron job removed**: the existing 14-minute ping
  (`cron.service.ts`) only existed to work around Render free-tier spin-down
  across _two_ services; with one service it's dead weight.
- **Validation**: `class-validator`/`class-transformer` (Nest-decorator-driven)
  are replaced by `zod` schemas, the idiomatic choice in the Nitro ecosystem.
- **Auth**: the global-middleware-sets-context / guard-reads-context pattern
  is preserved in shape, translated to Nitro `server/middleware/` writing to
  `event.context`, with a `requireAuth(event)` helper replacing `AuthGuard`.
- **API error contract**: the backend returns namespaced machine-readable
  string error codes only (e.g. `auth.invalid_credentials`); the frontend
  owns all user-facing translation. This retires the `ERROR_TYPE` Prisma enum,
  which was unused. Note this only covers API responses — see below.
- **Email i18n**: transactional emails (verification, password reset) still
  need server-rendered translated content, since there's no frontend
  involved in an email. `nestjs-i18n` is replaced by a minimal custom
  `t(key, lang)` dictionary util scoped only to the email templates; the
  `@sendgrid/mail` SDK call and `ejs` template are kept as-is (they were
  never Nest-specific).
- **Env vars**: collapsed into a single root `.env`. `PORT`, `API_URI`,
  `CLIENT_HOST`, `CLIENT_URL`, and `API_URL` are dropped — they only existed
  to let two services address each other and are meaningless once there's
  one same-origin app.

## Considered alternatives

- **Incremental strangler-fig migration** (routes move one domain module at a
  time, both apps run side by side): rejected — the app is small enough that
  the coordination overhead of running two apps mid-migration outweighs the
  risk reduction.
- **Keep Socket.IO via a standalone WS process** alongside the Nuxt server:
  rejected — reintroduces the two-service problem this migration exists to
  remove.
