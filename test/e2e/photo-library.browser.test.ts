import type { FakeS3Server } from './fake-s3-server'
import { Buffer } from 'node:buffer'
import process from 'node:process'
import { createPage, setup, url } from '@nuxt/test-utils/e2e'
import sharp from 'sharp'
import { afterAll, describe, expect, it } from 'vitest'
import { hashPassword } from '../../server/utils/crypto'
import { prisma } from '../../server/utils/prisma'
import { buildDecodableJpegWithDateTimeOriginal } from './exif-fixtures'
import { startFakeS3Server, testExternalId, testRoleArn } from './fake-s3-server'

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
        role_arn: testRoleArn,
        external_id: testExternalId,
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
        role_arn: testRoleArn,
        external_id: testExternalId,
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

  // issue #193: the details modal's photo can be zoomed (Ctrl+scroll /
  // pinch) and panned (drag) without the whole page zooming, resets on
  // photo navigation, and is clamped to a 3x maximum.
  it('zooms and pans the photo in the details modal, resetting on navigation', async () => {
    const zoomBucket = `${bucket}-zoom`
    fakeS3.seedBucket(zoomBucket)

    const zoomEmailPrefix = `${emailPrefix}-zoom`
    const zoomEmail = `${zoomEmailPrefix}@example.com`
    const bigPng = await sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 200, g: 100, b: 50 } } }).png().toBuffer()

    const user = await prisma.user.create({
      data: {
        email: zoomEmail,
        first_name: 'Jane',
        last_name: 'Doe',
        password: hashPassword(password),
        is_verified: true,
        verification_token: `token-${zoomEmailPrefix}`,
      },
    })

    await prisma.awsCredentials.create({
      data: {
        bucket: zoomBucket,
        region: 'eu-west-3',
        role_arn: testRoleArn,
        external_id: testExternalId,
        user: { connect: { id: user.id } },
      },
    })

    const page = await createPage('/login')
    await page.getByLabel('Email').fill(zoomEmail)
    await page.getByLabel('Password').fill(password)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()

    await page.waitForURL(url('/'))
    await page.getByText(`Welcome, Jane Doe`).waitFor()
    await page.getByText('Your photo library is empty').waitFor()

    await page.locator('input[type="file"]').first().setInputFiles({
      name: 'zoom-first.png',
      mimeType: 'image/png',
      // A real, sizeable image (unlike the other tests' 1x1 fixture) — the
      // zoom/pan interactions below need a substantial rendered box to drag
      // within, which a 1x1 source image doesn't give us.
      buffer: bigPng,
    })
    await page.locator('img[alt$="zoom-first.png"]').first().waitFor({ timeout: 15_000 })

    await page.locator('input[type="file"]').first().setInputFiles({
      name: 'zoom-second.png',
      mimeType: 'image/png',
      buffer: bigPng,
    })
    await page.locator('img[alt$="zoom-second.png"]').first().waitFor({ timeout: 15_000 })

    await page.locator('img[alt$="zoom-second.png"]').first().click()

    const detailsImage = page.locator('img[alt^="Photo "]')
    await detailsImage.waitFor()

    async function transformOf() {
      return detailsImage.evaluate((el: HTMLElement) => el.style.transform)
    }
    function scaleOf(transform: string) {
      return Number(transform.match(/scale\(([\d.]+)\)/)?.[1])
    }

    expect(scaleOf(await transformOf())).toBe(1)

    // Ctrl+scroll zooms in, clamped to a 3x maximum even with a lot of scroll.
    const box = (await detailsImage.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.keyboard.down('Control')
    await page.mouse.wheel(0, -4000)
    await page.keyboard.up('Control')

    await expect.poll(async () => scaleOf(await transformOf())).toBe(3)

    // Dragging pans the zoomed photo.
    const zoomedBox = (await detailsImage.boundingBox())!
    const center = { x: zoomedBox.x + zoomedBox.width / 2, y: zoomedBox.y + zoomedBox.height / 2 }
    await page.mouse.move(center.x, center.y)
    await page.mouse.down()
    await page.mouse.move(center.x - 40, center.y - 20, { steps: 5 })
    await page.mouse.up()

    expect(await transformOf()).toBe('translate(-40px, -20px) scale(3)')

    // Navigating (next-photo button) resets zoom/pan (the just-uploaded
    // photo sorts first/newest, so "next" moves to the earlier upload).
    const detailsAltBeforeNav = await detailsImage.getAttribute('alt')
    await page.getByRole('button', { name: 'Next photo' }).click()
    await expect.poll(() => detailsImage.getAttribute('alt')).not.toBe(detailsAltBeforeNav)
    expect(await transformOf()).toBe('translate(0px, 0px) scale(1)')

    await page.close()
  }, 60_000)

  // issue #193: a photo whose fitted size is much smaller than the viewing
  // area first *grows* in place as it's zoomed in, up to that area's
  // ceiling, only cropping/panning beyond that point.
  it('grows a small photo in place before cropping into it when zoomed', async () => {
    const smallZoomBucket = `${bucket}-small-zoom`
    fakeS3.seedBucket(smallZoomBucket)

    const smallZoomEmailPrefix = `${emailPrefix}-small-zoom`
    const smallZoomEmail = `${smallZoomEmailPrefix}@example.com`
    const smallPng = await sharp({ create: { width: 120, height: 90, channels: 3, background: { r: 50, g: 150, b: 200 } } }).png().toBuffer()

    const user = await prisma.user.create({
      data: {
        email: smallZoomEmail,
        first_name: 'Jane',
        last_name: 'Doe',
        password: hashPassword(password),
        is_verified: true,
        verification_token: `token-${smallZoomEmailPrefix}`,
      },
    })

    await prisma.awsCredentials.create({
      data: {
        bucket: smallZoomBucket,
        region: 'eu-west-3',
        role_arn: testRoleArn,
        external_id: testExternalId,
        user: { connect: { id: user.id } },
      },
    })

    const page = await createPage('/login')
    await page.getByLabel('Email').fill(smallZoomEmail)
    await page.getByLabel('Password').fill(password)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()

    await page.waitForURL(url('/'))
    await page.getByText(`Welcome, Jane Doe`).waitFor()
    await page.getByText('Your photo library is empty').waitFor()

    await page.locator('input[type="file"]').first().setInputFiles({
      name: 'small-photo.png',
      mimeType: 'image/png',
      // Much smaller than the modal's reserved viewing area (85vw/75vh),
      // so it never grows to fill it just by the plain "fit" CSS sizing.
      buffer: smallPng,
    })
    await page.locator('img[alt$="small-photo.png"]').first().waitFor({ timeout: 15_000 })

    await page.locator('img[alt$="small-photo.png"]').first().click()

    const detailsImage = page.locator('img[alt^="Photo "]')
    await detailsImage.waitFor()

    function scaleOf(transform: string) {
      return Number(transform.match(/scale\(([\d.]+)\)/)?.[1])
    }

    const fittedBox = (await detailsImage.boundingBox())!

    // Ctrl+scroll a small amount, well within the growth phase: the photo's
    // own box visibly grows, but it isn't cropped/panned yet (scale stays 1).
    await page.mouse.move(fittedBox.x + fittedBox.width / 2, fittedBox.y + fittedBox.height / 2)
    await page.keyboard.down('Control')
    await page.mouse.wheel(0, -50)
    await page.keyboard.up('Control')

    await expect.poll(async () => (await detailsImage.boundingBox())!.width).toBeGreaterThan(fittedBox.width * 1.5)
    expect(scaleOf(await detailsImage.evaluate((el: HTMLElement) => el.style.transform))).toBe(1)

    // Zooming further eventually maxes out the growth and starts cropping.
    await page.keyboard.down('Control')
    await page.mouse.wheel(0, -6000)
    await page.keyboard.up('Control')

    await expect.poll(async () => scaleOf(await detailsImage.evaluate((el: HTMLElement) => el.style.transform))).toBeGreaterThan(1)

    await page.close()
  }, 60_000)
})
