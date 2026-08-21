import { $fetch, setup } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'

// Black-box test proving an unmatched route serves the styled fatal-error
// page (app/error.vue) rather than Nuxt's bare default error screen, per
// docs/adr/0001-nuxt-server-replaces-nestjs-api.md's single HTTP-level test
// seam.
describe('error page', async () => {
  await setup()

  it('serves the styled 404 page for an unknown route', async () => {
    // Nitro serves a JSON error body unless the request signals it wants
    // HTML, exactly like a real browser navigation does.
    const html = await $fetch('/this-route-does-not-exist', {
      headers: { accept: 'text/html' },
      ignoreResponseError: true,
    })

    expect(html).toContain('Page not found')
  })
})
