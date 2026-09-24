import type { FakeS3Server } from './fake-s3-server'
import process from 'node:process'
import { createPage, setup, url } from '@nuxt/test-utils/e2e'
import { afterAll, describe, expect, it } from 'vitest'
import { hashPassword } from '../../server/utils/crypto'
import { prisma } from '../../server/utils/prisma'
import { startFakeS3Server, testExternalId, testRoleArn } from './fake-s3-server'

// Regression test for the SSR/hydration mismatch every `useVirtualGrid`
// consumer used to hit on a full page load: `@tanstack/virtual-core`'s own
// range calculation always reports zero visible rows server-side (there's
// no real viewport to measure), while the client's first render already has
// a real `window`/container to measure from — so the two disagreed on how
// many row elements (and what container height) to render, which Vue's
// hydration flagged as a mismatch. `useVirtualGrid` now keeps rows empty
// until mounted (matching what the server legitimately can render) and
// computes `totalSize` independently of the virtualizer's own internal
// state, so the two agree from the first paint through to hydration.
//
// This asserts against a genuine, cookie-authenticated full page load (not
// a client-side SPA navigation) for one page-level grid built directly on
// `useVirtualGrid` (the photo library) and one built on the shared
// `BaseVirtualGrid` wrapper (the albums list) — the two different call
// shapes in play across the app's 6 virtualized grids.
describe('virtualized grid hydration', async () => {
  const fakeS3: FakeS3Server = await startFakeS3Server()
  process.env.AWS_S3_ENDPOINT = fakeS3.url

  await setup({ browser: true, dev: true })

  const emailPrefix = `virtual-grid-hydration-${Date.now()}`
  const email = `${emailPrefix}@example.com`
  const password = 'Str0ng!Pass'
  const bucket = `virtual-grid-hydration-bucket-${Date.now()}`

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { startsWith: emailPrefix } } })
    await fakeS3.close()
  })

  async function collectHydrationWarnings(page: Awaited<ReturnType<typeof createPage>>, path: string) {
    const messages: string[] = []
    const onConsole = (msg: { text: () => string }) => {
      const text = msg.text()
      if (text.includes('Hydration'))
        messages.push(text)
    }
    page.on('console', onConsole)
    await page.goto(url(path), { waitUntil: 'hydration' } as never)
    await page.waitForTimeout(1500)
    page.off('console', onConsole)
    return messages
  }

  it('renders the photo library and albums list with no hydration warnings on a full page load', async () => {
    const user = await prisma.user.create({
      data: {
        email,
        first_name: 'Jane',
        last_name: 'Doe',
        password: hashPassword(password),
        is_verified: true,
        verification_token: `token-${emailPrefix}`,
      },
    })

    await prisma.storageConnection.create({
      data: {
        bucket,
        region: 'eu-west-3',
        role_arn: testRoleArn,
        external_id: testExternalId,
        user: { connect: { id: user.id } },
      },
    })

    await prisma.photo.createMany({
      data: Array.from({ length: 30 }, (_, index) => ({
        key: `photos/${user.id}/seed-${index}.jpg`,
        mime_type: 'image/jpeg',
        size: 1,
        last_modified: new Date(Date.now() - index * 60 * 60 * 1000),
        user_id: user.id,
      })),
    })

    for (let index = 0; index < 20; index++) {
      await prisma.album.create({
        data: {
          title: `Album ${index}`,
          admin: { connect: { id: user.id } },
          users: { connect: [{ id: user.id }] },
        },
      })
    }

    // A real cookie-authenticated login first, then full page loads (not
    // client-side navigations, so hydration genuinely runs) on the same
    // page/context for each grid page under test.
    const page = await createPage('/login')
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password').fill(password)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.waitForURL(url('/'))

    const photoLibraryWarnings = await collectHydrationWarnings(page, '/')
    expect(photoLibraryWarnings).toEqual([])

    const albumsListWarnings = await collectHydrationWarnings(page, '/albums')
    expect(albumsListWarnings).toEqual([])

    await page.close()
  }, 60_000)
})
