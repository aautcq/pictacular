import type { FakeS3Server } from './fake-s3-server'
import process from 'node:process'
import { createPage, setup, url } from '@nuxt/test-utils/e2e'
import { afterAll, describe, expect, it } from 'vitest'
import { hashPassword } from '../../server/utils/crypto'
import { prisma } from '../../server/utils/prisma'
import { startFakeS3Server, testExternalId, testRoleArn } from './fake-s3-server'

// Regression test: a photo row's rendered height is frozen the first time
// `@tanstack/vue-virtual` measures it, and never invalidated purely
// because `columnWidth` later changes (its underlying cache only
// invalidates on a `count`/`scrollMargin`/`gap` change — see
// `useVirtualGrid`'s `measure()` call). Resizing the viewport (e.g.
// opening devtools, which narrows the page) changes `columnWidth`/
// `columnCount` without necessarily changing `scrollMargin`, so every
// already-rendered row — most visibly a single-photo day's lone photo
// row — used to stay stuck at its pre-resize size instead of resizing to
// match the new column width. This seeds one photo per day (every photo
// row is a single-photo row), resizes the viewport after the initial
// render, and asserts the tile actually resizes to the new square size.
describe('photo library single-photo day row height', async () => {
  const fakeS3: FakeS3Server = await startFakeS3Server()
  process.env.AWS_S3_ENDPOINT = fakeS3.url

  await setup({ browser: true })

  const emailPrefix = `photo-row-height-${Date.now()}`
  const email = `${emailPrefix}@example.com`
  const password = 'Str0ng!Pass'
  const bucket = `photo-row-height-bucket-${Date.now()}`

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { startsWith: emailPrefix } } })
    await fakeS3.close()
  })

  it('resizes a single-photo day\'s photo tile to match the new column width after a viewport resize', async () => {
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

    // One photo per distinct day (each 24h apart) so every group in the
    // timeline is a single-photo-row day.
    const baseDate = new Date('2024-06-01T12:00:00Z')
    await prisma.photo.createMany({
      data: Array.from({ length: 5 }, (_, index) => ({
        key: `photos/${user.id}/seed-${index}.jpg`,
        mime_type: 'image/jpeg',
        size: 1,
        last_modified: new Date(baseDate.getTime() + index * 24 * 60 * 60 * 1000),
        user_id: user.id,
      })),
    })

    const page = await createPage('/login')
    await page.setViewportSize({ width: 1280, height: 900 })

    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password').fill(password)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()

    await page.waitForURL(url('/'))
    await page.getByText(`Welcome, Jane Doe`).waitFor()

    const tile = page.locator('button[title="Select"]').first().locator('..')
    await tile.waitFor()

    const wideBox = (await tile.boundingBox())!
    // Sanity check: a healthy tile is square (height matches width).
    expect(Math.abs(wideBox.height - wideBox.width)).toBeLessThan(2)

    // Narrow the viewport enough to drop a column-count breakpoint
    // (1280px -> 6 columns; 500px -> 2 columns), changing `columnWidth`
    // without necessarily changing the grid container's own top offset
    // (`scrollMargin`) — the exact condition that used to leave the
    // already-rendered row frozen at its pre-resize size.
    await page.setViewportSize({ width: 500, height: 900 })
    await expect.poll(async () => (await tile.boundingBox())!.width, { timeout: 5_000 }).not.toBe(wideBox.width)

    const narrowBox = (await tile.boundingBox())!
    expect(Math.abs(narrowBox.height - narrowBox.width)).toBeLessThan(2)
    // A 2-column, 500px-wide layout produces meaningfully wider tiles
    // than a 6-column, 1280px-wide one.
    expect(narrowBox.width).toBeGreaterThan(wideBox.width)

    await page.close()
  }, 60_000)
})
