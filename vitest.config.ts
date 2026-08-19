import { defineConfig } from 'vitest/config'

// Plain Vitest config (not `defineVitestConfig`, which now targets Nuxt's
// client "nuxt" test environment): every spec here uses `@nuxt/test-utils`'s
// `setup()` to boot a real instance of this app in its own process, so specs
// exercise the HTTP (and WS) boundary as a black box rather than
// importing/mocking server internals directly.
export default defineConfig({
  test: {
    testTimeout: 30_000,
  },
})
