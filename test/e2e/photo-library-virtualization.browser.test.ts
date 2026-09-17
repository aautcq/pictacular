import type { FakeS3Server } from './fake-s3-server'
import process from 'node:process'
import { createPage, setup, url } from '@nuxt/test-utils/e2e'
import { afterAll, describe, expect, it } from 'vitest'
import { hashPassword } from '../../server/utils/crypto'
import { prisma } from '../../server/utils/prisma'
import { startFakeS3Server, testExternalId, testRoleArn } from './fake-s3-server'

// Regression test for issue #175 (see docs/adr/0009-tanstack-virtual-for-photo-and-album-grids.md):
// the photo library page used to mount one live DOM node per loaded Photo,
// growing unbounded as more pages loaded. This seeds a User with 1,000+
// Photos directly via Prisma (bypassing the fake-S3 upload flow entirely —
// only the listing endpoint's `taken_at`/`last_modified` ordering and the
// client's virtualized rendering are under test here, not the upload
// pipeline) and asserts the number of rendered gallery cells stays bounded
// both right after the first page loads and after scrolling through the
// full, fully-paginated list.
describe('photo library grid virtualization', async () => {
  const fakeS3: FakeS3Server = await startFakeS3Server()
  process.env.AWS_S3_ENDPOINT = fakeS3.url

  await setup({ browser: true })

  const emailPrefix = `photo-virtualization-${Date.now()}`
  const email = `${emailPrefix}@example.com`
  const password = 'Str0ng!Pass'
  const bucket = `photo-virtualization-bucket-${Date.now()}`
  const totalPhotos = 1_200
  // A bounded-DOM assertion needs a ceiling comfortably above what a single
  // viewport's worth of overscanned rows could ever render (a handful of
  // rows at up to 6 columns each), but far below `totalPhotos` — proving
  // the grid isn't just mounting everything.
  const maxRenderedCells = 150

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { startsWith: emailPrefix } } })
    await fakeS3.close()
  })

  it('keeps the rendered gallery cell count bounded regardless of how many photos have loaded', async () => {
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

    await prisma.awsCredentials.create({
      data: {
        bucket,
        region: 'eu-west-3',
        role_arn: testRoleArn,
        external_id: testExternalId,
        user: { connect: { id: user.id } },
      },
    })

    // Spread across many distinct days (oldest first) so the date-grouped
    // timeline builds many header rows too, not just photo rows — the
    // oldest photo's own day is asserted on below as proof the client
    // actually paginated all the way through, rather than stopping after
    // the first page.
    const oldestDate = new Date('2020-01-01T12:00:00Z')
    await prisma.photo.createMany({
      data: Array.from({ length: totalPhotos }, (_, index) => {
        const lastModified = new Date(oldestDate.getTime() + index * 60 * 60 * 1000)
        return {
          key: `photos/${user.id}/seed-${index}.jpg`,
          mime_type: 'image/jpeg',
          size: 1,
          last_modified: lastModified,
          user_id: user.id,
        }
      }),
    })

    const page = await createPage('/login')
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password').fill(password)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()

    await page.waitForURL(url('/'))
    await page.getByText(`Welcome, Jane Doe`).waitFor()

    const gridCells = page.locator('button[title="Select"]')

    await gridCells.first().waitFor()
    expect(await gridCells.count()).toBeLessThan(maxRenderedCells)

    // Scroll to the bottom repeatedly until the "near the end of what's
    // loaded" fetch trigger has pulled every page — the document keeps
    // growing (the virtualizer's total content height reflects however
    // much of `groupedByDate` has loaded so far) until every page has
    // arrived, at which point scrollHeight stops changing across
    // consecutive scrolls.
    let previousScrollHeight = -1
    let stableReadings = 0
    for (let attempt = 0; attempt < 150 && stableReadings < 3; attempt++) {
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
      await page.waitForTimeout(300)
      const scrollHeight = await page.evaluate(() => document.documentElement.scrollHeight)
      stableReadings = scrollHeight === previousScrollHeight ? stableReadings + 1 : 0
      previousScrollHeight = scrollHeight
    }
    await page.getByText('Loading…').waitFor({ state: 'hidden' })

    await page.getByRole('heading', { name: /January 1, 2020/ }).waitFor({ timeout: 15_000 })

    expect(await gridCells.count()).toBeLessThan(maxRenderedCells)

    const seededCount = await prisma.photo.count({ where: { user_id: user.id } })
    expect(seededCount).toBe(totalPhotos)

    await page.close()
  }, 90_000)
})
