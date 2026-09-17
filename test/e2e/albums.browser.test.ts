import type { FakeS3Server } from './fake-s3-server'
import process from 'node:process'
import { $fetch, createPage, fetch, setup, url } from '@nuxt/test-utils/e2e'
import { afterAll, describe, expect, it } from 'vitest'
import { hashPassword } from '../../server/utils/crypto'
import { prisma } from '../../server/utils/prisma'
import { startFakeS3Server, testExternalId, testRoleArn } from './fake-s3-server'

// Browser-driven test (issue #51): a signed-in User with a Storage
// Connection and one Photo already in their library creates an Album,
// adds that Photo to it via the photo picker, renames the Album inline,
// then deletes it — covering the full "create → add photos → rename →
// delete" journey the acceptance criteria calls for. Real AWS is replaced
// by the same in-process fake S3 double used by the HTTP coverage in
// albums.test.ts.
describe('albums journey', async () => {
  const fakeS3: FakeS3Server = await startFakeS3Server()
  process.env.AWS_S3_ENDPOINT = fakeS3.url

  await setup({ browser: true })

  const emailPrefix = `albums-journey-${Date.now()}`
  const email = `${emailPrefix}@example.com`
  const password = 'Str0ng!Pass'
  const bucket = `albums-journey-bucket-${Date.now()}`
  // A minimal 1x1 red PNG, so the seeded Photo has real image bytes.
  const tinyPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { startsWith: emailPrefix } } })
    await fakeS3.close()
  })

  it('creates an album, adds a photo, renames it, then deletes it', async () => {
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

    const loginResponse = await fetch('/api/auth/sessions', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
      headers: { 'content-type': 'application/json' },
    })
    const cookieHeader = loginResponse.headers.getSetCookie().map(cookie => cookie.split(';')[0]).join('; ')

    await $fetch('/api/photos', {
      method: 'POST',
      headers: { cookie: cookieHeader },
      body: { filename: 'sunset.png', mime_type: 'image/png', base64: tinyPngBase64 },
    })

    const page = await createPage('/login')
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password').fill(password)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.waitForURL(url('/'))

    await page.getByRole('link', { name: 'Albums' }).click()
    await page.waitForURL(url('/albums'))
    await page.getByText('You don\'t have any albums yet').waitFor()

    await page.getByRole('link', { name: 'New album' }).click()
    await page.waitForURL(url('/albums/new'))
    await page.getByLabel('Title').fill('Summer Trip')
    await page.getByRole('button', { name: 'Create album' }).click()

    await page.waitForURL(/\/albums\/\d+$/)
    await page.getByText('This album is empty').waitFor()

    // Toolbar actions live behind the "Settings" dropdown menu (see
    // app/pages/albums/[id].vue's settingsItems), not standalone buttons.
    await page.getByRole('button', { name: 'Settings' }).click()
    await page.getByRole('menuitem', { name: 'Add photos' }).click()
    // The gallery grid's alt text is the uploaded object's S3 key filename
    // (see app/components/BaseGalleryPhoto.vue's getPhotoFileName), which
    // is prefixed with a UUID by uploadPhotoObject, hence the suffix match.
    await page.getByRole('dialog').locator('img[alt$="sunset.png"]').first().click()
    await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click()

    await page.locator('img[alt$="sunset.png"]').first().waitFor()
    await page.getByText('This album is empty').waitFor({ state: 'hidden' })

    await page.getByRole('button', { name: 'Summer Trip' }).click()
    // Scoped to the title UInput by name — `.first()` on a bare `input`
    // locator would otherwise resolve to the hidden file-upload input
    // rendered earlier in the header actions.
    await page.locator('input[name="title"]').fill('Renamed Trip')
    await page.locator('input[name="title"]').blur()
    await page.getByRole('button', { name: 'Renamed Trip' }).waitFor()

    await page.getByRole('button', { name: 'Settings' }).click()
    await page.getByRole('menuitem', { name: 'Delete' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click()

    await page.waitForURL(url('/albums'))
    await page.getByText('You don\'t have any albums yet').waitFor()

    const remainingAlbums = await prisma.album.count({ where: { admin_id: user.id } })
    expect(remainingAlbums).toBe(0)

    await page.close()
  }, 60_000)
})
