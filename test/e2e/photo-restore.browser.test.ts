import type { FakeS3Server } from './fake-s3-server'
import process from 'node:process'
import { createPage, setup, url } from '@nuxt/test-utils/e2e'
import { afterAll, describe, expect, it } from 'vitest'
import { hashPassword } from '../../server/utils/crypto'
import { prisma } from '../../server/utils/prisma'
import { startFakeS3Server, testExternalId, testRoleArn } from './fake-s3-server'

// Browser-driven test (issue #145): a signed-in User with an Archived
// Photo already in their library sees a clear "Archived" placeholder
// instead of a broken image, clicks Restore, and sees the gallery reflect
// the Restore Request going into progress — the UI counterpart to the
// HTTP/task coverage in photo-restore.test.ts and
// archived-photos-task.test.ts. Real AWS is replaced by the same
// in-process fake S3 double those specs use.
describe('archived photo restore journey', async () => {
  const fakeS3: FakeS3Server = await startFakeS3Server()
  process.env.AWS_S3_ENDPOINT = fakeS3.url

  await setup({ browser: true })

  const emailPrefix = `photo-restore-${Date.now()}`
  const email = `${emailPrefix}@example.com`
  const password = 'Str0ng!Pass'
  const bucket = `photo-restore-bucket-${Date.now()}`

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { startsWith: emailPrefix } } })
    await fakeS3.close()
  })

  it('shows an Archived placeholder and restores the photo on request', async () => {
    fakeS3.seedBucket(bucket, [{ key: 'archived.jpg', storageClass: 'GLACIER' }])

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

    await prisma.photo.create({
      data: {
        key: 'archived.jpg',
        mime_type: 'image/jpeg',
        size: 1,
        last_modified: new Date(),
        storage_class: 'GLACIER',
        user: { connect: { id: user.id } },
      },
    })

    const page = await createPage('/login')
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password').fill(password)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()

    await page.waitForURL(url('/'))
    await page.getByText('Archived', { exact: true }).waitFor()

    await page.getByRole('button', { name: 'Restore', exact: true }).click()
    await page.getByText('Restoring…').waitFor()

    const photo = await prisma.photo.findFirstOrThrow({ where: { user_id: user.id } })
    expect(photo.restore_ongoing).toBe(true)

    await page.close()
  }, 60_000)
})
