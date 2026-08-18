import { $fetch, setup } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'

// Trivial black-box smoke test proving the collapsed Nuxt/Nitro app boots and
// answers real HTTP requests, per the single HTTP/WS request-response test
// seam this migration establishes (see docs/adr/0001-nuxt-server-replaces-nestjs-api.md).
describe('app boot smoke test', async () => {
  await setup()

  it('serves the home page over HTTP', async () => {
    const html = await $fetch('/')

    expect(html).toContain('<div id="__nuxt">')
  })
})
