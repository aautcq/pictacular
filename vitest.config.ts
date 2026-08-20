import { defineConfig } from 'vitest/config'

// Plain Vitest config (not `defineVitestConfig`, which now targets Nuxt's
// client "nuxt" test environment): every spec here uses `@nuxt/test-utils`'s
// `setup()` to boot a real instance of this app in its own process, so specs
// exercise the HTTP (and WS) boundary as a black box rather than
// importing/mocking server internals directly.
export default defineConfig({
  test: {
    testTimeout: 30_000,
    // Auth cookies are scoped to `COOKIE_DOMAIN` (set to `pictacular.dev` in
    // `.env` to match the local HTTPS dev server). `@nuxt/test-utils` boots
    // its server on an ephemeral `127.0.0.1` port instead, so a `.env`-scoped
    // domain cookie would never match the test server's host and get
    // silently dropped by the browser — unset it for the test run so cookies
    // apply to whatever host the test server actually binds to.
    env: {
      COOKIE_DOMAIN: '',
    },
  },
})
