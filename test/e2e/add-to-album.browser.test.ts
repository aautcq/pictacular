import type { FakeS3Server } from './fake-s3-server'
import { Buffer } from 'node:buffer'
import process from 'node:process'
import { createPage, setup, url } from '@nuxt/test-utils/e2e'
import { afterAll, describe, expect, it } from 'vitest'
import { hashPassword } from '../../server/utils/crypto'
import { prisma } from '../../server/utils/prisma'
import { startFakeS3Server, testExternalId, testRoleArn } from './fake-s3-server'

// Browser-driven test: a signed-in User with a Storage Connection and a
// couple of existing Albums uploads a Photo to their personal library,
// selects it, then uses the "Add to album" action from the selection
// menu — covering the AddToAlbumModal's search-then-pick journey (mirrors
// the "Add photos" flow already covered by albums.browser.test.ts, but
// starting from the photo library rather than the Album show page).
describe('add to album journey', async () => {
  const fakeS3: FakeS3Server = await startFakeS3Server()
  process.env.AWS_S3_ENDPOINT = fakeS3.url

  await setup({ browser: true })

  const emailPrefix = `add-to-album-${Date.now()}`
  const email = `${emailPrefix}@example.com`
  const password = 'Str0ng!Pass'
  const bucket = `add-to-album-bucket-${Date.now()}`
  // A minimal 1x1 red PNG, so the uploaded Photo has real image bytes.
  const tinyPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { startsWith: emailPrefix } } })
    await fakeS3.close()
  })

  it('picks an album, matching the search, from the selection menu and adds the selected photo to it', async () => {
    fakeS3.seedBucket(bucket)

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

    // Both `admin` and `users` must be connected — the album membership
    // relation used by GET /api/albums (see server/api/albums/index.get.ts)
    // is `users`, separate from `admin_id`.
    await prisma.album.create({ data: { title: 'Summer Trip', admin: { connect: { id: user.id } }, users: { connect: { id: user.id } } } })
    const winterAlbum = await prisma.album.create({ data: { title: 'Winter Trip', admin: { connect: { id: user.id } }, users: { connect: { id: user.id } } } })

    const page = await createPage('/login')
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password').fill(password)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.waitForURL(url('/'))

    await page.locator('input[type="file"]').first().setInputFiles({
      name: 'sunset.png',
      mimeType: 'image/png',
      buffer: Buffer.from(tinyPngBase64, 'base64'),
    })
    // The gallery grid's alt text is the uploaded object's S3 key filename
    // (see app/components/BaseGalleryPhoto.vue's getPhotoFileName), which
    // is prefixed with a UUID by uploadPhotoObject, hence the suffix match.
    await page.locator('img[alt$="sunset.png"]').first().waitFor({ timeout: 15_000 })

    await page.getByRole('button', { name: 'Select' }).first().click()
    await page.getByText('1 selected').waitFor()

    await page.getByRole('button', { name: 'Settings' }).click()
    await page.getByRole('menuitem', { name: 'Add to album' }).click()

    const dialog = page.getByRole('dialog')
    await dialog.getByText('Summer Trip').waitFor()
    await dialog.getByText('Winter Trip').waitFor()

    await dialog.getByLabel('Search albums').fill('Winter')
    await dialog.getByText('Summer Trip').waitFor({ state: 'hidden' })
    await dialog.getByText('Winter Trip').click()

    // Scoped to the toast's visible title to avoid Playwright strict-mode
    // matching the aria-live announcer span too (see
    // i18n-error-messages.browser.test.ts's identical fix).
    await page.locator('[data-slot="title"]').getByText('Added to album.').waitFor()
    await page.getByText('1 selected').waitFor({ state: 'hidden' })

    const photoCount = await prisma.albumsOnPhotos.count({ where: { album_id: winterAlbum.id } })
    expect(photoCount).toBe(1)

    await page.close()
  }, 60_000)
})
