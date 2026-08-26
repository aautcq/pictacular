import { defineConfig } from 'vitest/config'

// Plain Vitest config (not `defineVitestConfig`, which now targets Nuxt's
// client "nuxt" test environment): every spec here uses `@nuxt/test-utils`'s
// `setup()` to boot a real instance of this app in its own process, so specs
// exercise the HTTP (and WS) boundary as a black box rather than
// importing/mocking server internals directly.
export default defineConfig({
  test: {
    // Running the full suite spins up ~15 separate booted app instances (each
    // with its own Nitro server + Playwright browser) in parallel, which can
    // make individual page actions take longer than they would in isolation
    // under CPU contention; 30s was occasionally too tight for that (a
    // different, otherwise-passing test would time out on each full run).
    testTimeout: 45_000,
    // Auth cookies are scoped to `NUXT_COOKIE_DOMAIN` (an operator-set `.env`
    // value, e.g. a deployed hostname). `@nuxt/test-utils` boots its server
    // on an ephemeral `127.0.0.1` port instead, so a `.env`-scoped domain
    // cookie would never match the test server's host and get silently
    // dropped by the browser — unset it for the test run so cookies apply to
    // whatever host the test server actually binds to.
    env: {
      NUXT_COOKIE_DOMAIN: '',
    },
  },
})
