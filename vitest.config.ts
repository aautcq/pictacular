import { defineVitestConfig } from '@nuxt/test-utils/config'

// Nuxt/Nitro-aware Vitest config: `@nuxt/test-utils` boots a real instance of
// this app for tests, so specs exercise the HTTP (and, later, WS) boundary as
// a black box rather than importing/mocking server internals directly.
export default defineVitestConfig({
  test: {
    testTimeout: 30_000,
  },
})
