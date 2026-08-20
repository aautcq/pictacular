import type { FakeS3Server } from './fake-s3-server'
import { Buffer } from 'node:buffer'
import process from 'node:process'
import { createPage, setup, url } from '@nuxt/test-utils/e2e'
import { afterAll, describe, expect, it } from 'vitest'
import { hashPassword } from '../../server/utils/crypto'
import { encodeAwsCredentials } from '../../server/utils/jwt'
import { prisma } from '../../server/utils/prisma'
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
    await page.getByRole('button', { name: 'Sign in' }).click()

    await page.waitForURL(url('/'))
    await page.getByText(`Welcome, Jane Doe`).waitFor()
    await page.getByText('Your photo library is empty').waitFor()

    await page.locator('input[type="file"]').first().setInputFiles({
      name: 'sunset.png',
      mimeType: 'image/png',
      buffer: Buffer.from(tinyPngBase64, 'base64'),
    })

    await page.locator('img[alt^="Photo "]').first().waitFor({ timeout: 15_000 })

    await page.locator('img[alt^="Photo "]').first().click()
    await page.getByRole('button', { name: 'Like' }).click()
    await page.getByRole('button', { name: 'Liked' }).waitFor()
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Liked' }).waitFor({ state: 'hidden' })

    await page.getByRole('button', { name: 'Select' }).first().click()
    await page.getByText('1 selected').waitFor()

    await page.getByRole('button', { name: 'Delete', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click()

    await page.getByText('Your photo library is empty').waitFor()

    const remaining = await prisma.photo.count({ where: { user_id: user.id } })
    expect(remaining).toBe(0)

    await page.close()
  }, 60_000)
})
