import type { FakeS3Server } from './fake-s3-server'
import process from 'node:process'
import { createPage, setup, url } from '@nuxt/test-utils/e2e'
import { afterAll, describe, it } from 'vitest'
import { hashPassword } from '../../server/utils/crypto'
import { prisma } from '../../server/utils/prisma'
import { startFakeS3Server } from './fake-s3-server'

// Browser-driven test (issue #150): a signed-in, verified User without a
// Storage Connection is redirected from the app's home page to the
// onboarding screen (requiresStorageConnection guard), walks through the
// Launch-Stack "create a new bucket" flow (AWS Account ID → launch →
// confirm once CloudFormation has finished), and lands back on the app
// once connected. Real AWS is replaced by the same in-process fake S3/STS
// double used by storage-connections.test.ts's HTTP coverage.
describe('storage connection onboarding journey', async () => {
  const fakeS3: FakeS3Server = await startFakeS3Server()
  process.env.AWS_S3_ENDPOINT = fakeS3.url

  await setup({ browser: true })

  const emailPrefix = `storage-onboarding-${Date.now()}`
  const email = `${emailPrefix}@example.com`
  const password = 'Str0ng!Pass'

  afterAll(async () => {
    const users = await prisma.user.findMany({ where: { email: { startsWith: emailPrefix } } })
    const userIds = users.map(user => user.id)
    await prisma.albumsOnPhotos.deleteMany({ where: { album: { admin_id: { in: userIds } } } })
    await prisma.album.deleteMany({ where: { admin_id: { in: userIds } } })
    await prisma.user.deleteMany({ where: { email: { startsWith: emailPrefix } } })
    await fakeS3.close()
  })

  it('redirects a User without a Storage Connection to onboarding, then lets them through once connected', async () => {
    await prisma.user.create({
      data: {
        email,
        first_name: 'Jane',
        last_name: 'Doe',
        password: hashPassword(password),
        is_verified: true,
        verification_token: `token-${emailPrefix}`,
      },
    })

    const page = await createPage('/login')
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password').fill(password)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()

    await page.waitForURL('**/storage-connection')
    await page.getByText('Connect your storage').waitFor()

    await page.getByLabel('AWS Account ID').fill('123456789012')
    const [launchResponse] = await Promise.all([
      page.waitForResponse(response => response.url().includes('/api/storage-connections/launch') && response.ok()),
      page.getByRole('button', { name: 'Launch Stack' }).click(),
    ])
    // Simulates the CloudFormation stack the User "launched" (in a real
    // browser this opens a new AWS Console tab, not exercised here) having
    // finished creating the bucket the launch response pre-filled it with.
    const { launch_url: launchUrl } = await launchResponse.json() as { launch_url: string }
    const bucket = new URLSearchParams(launchUrl.split('#')[1]?.split('?')[1]).get('param_BucketName')!
    fakeS3.seedBucket(bucket)

    await page.getByRole('button', { name: 'I\'ve launched it, confirm connection' }).click()

    await page.getByText('Your storage connection is ready.').waitFor()
    // UButton with `to="/"` renders as an <a>, not a <button> — so it's an
    // accessible link, not a button.
    await page.getByRole('link', { name: 'Continue' }).click()

    await page.waitForURL(url('/'))
    await page.getByText(`Welcome, Jane Doe`).waitFor()

    await page.goto(url('/'))
    await page.getByText(`Welcome, Jane Doe`).waitFor()

    await page.close()
  }, 60_000)

  // Issue #54: connecting an existing bucket that `check-bucket` reports
  // as already containing images offers this extra "import" step, with
  // live progress (over the same WS infra photo-import.test.ts's HTTP
  // coverage asserts on directly) and a completion state, before an
  // Album derived from the seeded bucket's folder structure appears.
  // TODO(#152): "connect an existing bucket" mode was removed from the
  // Storage Connection schema/endpoints by issue #150 (AwsCredentials no
  // longer stores an AWS key pair at all) and is rebuilt as its own,
  // separately-authenticated flow there — re-enable this once that lands.
  it.skip('offers an import step with live progress when connecting a bucket with existing images', async () => {
    const importEmail = `${emailPrefix}-import@example.com`
    await prisma.user.create({
      data: {
        email: importEmail,
        first_name: 'Import',
        last_name: 'Tester',
        password: hashPassword(password),
        is_verified: true,
        verification_token: `token-${emailPrefix}-import`,
      },
    })

    const bucket = `import-onboarding-${emailPrefix}`
    fakeS3.seedBucket(bucket, ['vacation/photo1.jpg', 'vacation/photo2.jpg'])

    const page = await createPage('/login')
    await page.getByLabel('Email').fill(importEmail)
    await page.getByLabel('Password').fill(password)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()

    await page.waitForURL('**/storage-connection')
    await page.getByRole('button', { name: 'I already have a bucket' }).click()
    await page.getByLabel('Bucket name').fill(bucket)
    await page.getByLabel('Access key ID').fill('AKIATEST')
    await page.getByLabel('Secret access key').fill('test-secret')
    await page.getByRole('button', { name: 'Connect' }).click()

    await page.getByText('It looks like your bucket already has some image files in it.').waitFor()
    await page.getByRole('button', { name: 'Import my existing photos' }).click()

    await page.getByText('Imported 2 photos into 1 album.').waitFor()
    // UButton with `to="/"` renders as an <a>, not a <button> — so it's an
    // accessible link, not a button.
    await page.getByRole('link', { name: 'Continue' }).click()

    await page.waitForURL(url('/'))
    await page.getByText(`Welcome, Import Tester`).waitFor()

    await page.goto(url('/albums'))
    await page.getByText('vacation').waitFor()

    await page.close()
  }, 60_000)
})
