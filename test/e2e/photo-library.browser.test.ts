import type { FakeS3Server } from './fake-s3-server'
import { Buffer } from 'node:buffer'
import process from 'node:process'
import { createPage, setup, url } from '@nuxt/test-utils/e2e'
import { afterAll, describe, expect, it } from 'vitest'
import { hashPassword } from '../../server/utils/crypto'
import { encodeAwsCredentials } from '../../server/utils/jwt'
import { prisma } from '../../server/utils/prisma'
import { buildDecodableJpegWithDateTimeOriginal } from './exif-fixtures'
import { startFakeS3Server } from './fake-s3-server'

// Browser-driven test (issue #50): a signed-in User with a Storage
// Connection uploads a Photo via the personal photo library's dropzone,
// sees it appear in the date-grouped timeline (via the real-time
// "photo uploaded" WS notification), likes it from the details modal, then
// selects and deletes it. Real AWS is replaced by the same in-process fake
// S3 double used by the HTTP coverage in photos.test.ts.
describe('personal photo library journey', async () => {
  const fakeS3: FakeS3Server = await startFakeS3Server()
  process.env.AWS_S3_ENDPOINT = fakeS3.url

  await setup({ browser: true })

  const emailPrefix = `photo-library-${Date.now()}`
  const email = `${emailPrefix}@example.com`
  const password = 'Str0ng!Pass'
  const bucket = `photo-library-bucket-${Date.now()}`
  // A minimal 1x1 red PNG, so the upload has real image bytes.
  const tinyPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { startsWith: emailPrefix } } })
    await fakeS3.close()
  })

  it('uploads a photo, sees it appear, likes it, then deletes it', async () => {
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

    await prisma.awsCredentials.create({
      data: {
        bucket,
        region: 'eu-west-3',
        tokens: encodeAwsCredentials({ access_key_id: 'AKIATEST', secret_access_key: 'test-secret' }),
        user: { connect: { id: user.id } },
      },
    })

    const page = await createPage('/login')
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password').fill(password)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()

    await page.waitForURL(url('/'))
    await page.getByText(`Welcome, Jane Doe`).waitFor()
    await page.getByText('Your photo library is empty').waitFor()

    await page.locator('input[type="file"]').first().setInputFiles({
      name: 'sunset.png',
      mimeType: 'image/png',
      buffer: Buffer.from(tinyPngBase64, 'base64'),
    })

    // The gallery grid's alt text is the uploaded object's S3 key filename
    // (see app/components/BaseGalleryPhoto.vue's getPhotoFileName), which
    // is prefixed with a UUID by uploadPhotoObject, hence the suffix match.
    await page.locator('img[alt$="sunset.png"]').first().waitFor({ timeout: 15_000 })

    await page.locator('img[alt$="sunset.png"]').first().click()
    await page.getByRole('button', { name: 'Like' }).click()
    await page.getByRole('button', { name: 'Liked' }).waitFor()
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Liked' }).waitFor({ state: 'hidden' })

    await page.getByRole('button', { name: 'Select' }).first().click()
    await page.getByText('1 selected').waitFor()

    // Delete lives in the selection toolbar's "Settings" dropdown menu
    // (see app/pages/index.vue's settingsItems), not a standalone button.
    await page.getByRole('button', { name: 'Settings' }).click()
    await page.getByRole('menuitem', { name: 'Delete' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click()

    await page.getByText('Your photo library is empty').waitFor()

    const remaining = await prisma.photo.count({ where: { user_id: user.id } })
    expect(remaining).toBe(0)

    await page.close()
  }, 60_000)

  // issue #164: a Photo's gallery date-group header must reflect its EXIF
  // Taken At (issue #162), not its S3 object's last_modified — the bug a
  // bucket re-import surfaced, since re-uploading bumps every object's own
  // last_modified to "now" despite each photo's real Taken At being
  // years in the past.
  it('groups an uploaded photo by its EXIF taken_at date, not today\'s last_modified date', async () => {
    const groupingBucket = `${bucket}-grouping`
    fakeS3.seedBucket(groupingBucket)

    const groupingEmailPrefix = `${emailPrefix}-grouping`
    const groupingEmail = `${groupingEmailPrefix}@example.com`

    const user = await prisma.user.create({
      data: {
        email: groupingEmail,
        first_name: 'Jane',
        last_name: 'Doe',
        password: hashPassword(password),
        is_verified: true,
        verification_token: `token-${groupingEmailPrefix}`,
      },
    })

    await prisma.awsCredentials.create({
      data: {
        bucket: groupingBucket,
        region: 'eu-west-3',
        tokens: encodeAwsCredentials({ access_key_id: 'AKIATEST', secret_access_key: 'test-secret' }),
        user: { connect: { id: user.id } },
      },
    })

    const page = await createPage('/login')
    await page.getByLabel('Email').fill(groupingEmail)
    await page.getByLabel('Password').fill(password)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()

    await page.waitForURL(url('/'))
    await page.getByText(`Welcome, Jane Doe`).waitFor()
    await page.getByText('Your photo library is empty').waitFor()

    const oldTakenAt = new Date('2016-07-16T15:50:00')
    const oldJpeg = buildDecodableJpegWithDateTimeOriginal(oldTakenAt)

    // Upload the undated (today-dated) photo *first*, then the old EXIF
    // photo second — an inverted upload order that would trip up a naive
    // "always prepend the newest upload" list update: the old photo must
    // still land in its correct chronological position (after today's
    // group), not jump to the front just because it was uploaded last.
    await page.locator('input[type="file"]').first().setInputFiles({
      name: 'todays-shot.png',
      mimeType: 'image/png',
      buffer: Buffer.from(tinyPngBase64, 'base64'),
    })
    await page.locator('img[alt$="todays-shot.png"]').first().waitFor({ timeout: 15_000 })

    await page.locator('input[type="file"]').first().setInputFiles({
      name: 'old-holiday.jpg',
      mimeType: 'image/jpeg',
      buffer: oldJpeg,
    })
    await page.locator('img[alt$="old-holiday.jpg"]').first().waitFor({ timeout: 15_000 })

    const groupHeadings = await page.getByRole('heading', { level: 2 }).allTextContents()

    // Two distinct date groups, newest first: today's undated upload's own
    // header, then the EXIF-dated upload's 2016 header — never merged into
    // a single "today" group, and never reordered just because the older
    // photo was uploaded last.
    expect(groupHeadings).toHaveLength(2)
    expect(groupHeadings[0]).not.toContain('2016')
    expect(groupHeadings[1]).toContain('2016')

    await page.close()
  }, 60_000)
})
