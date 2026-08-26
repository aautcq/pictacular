import type { FakeS3Server } from './fake-s3-server'
import process from 'node:process'
import { $fetch, createPage, fetch, setup, url } from '@nuxt/test-utils/e2e'
import { afterAll, describe, expect, it } from 'vitest'
import { hashPassword } from '../../server/utils/crypto'
import { encodeAwsCredentials } from '../../server/utils/jwt'
import { prisma } from '../../server/utils/prisma'
import { startFakeS3Server } from './fake-s3-server'

// Browser-driven test (issue #53): an Album admin opens the Share modal
// from the Album show page, generates a Public Share Link, and copies it;
// a second, cookie-isolated browser page (nobody is logged in) then
// navigates straight to that link and sees the Album's title and Photo,
// with no like/edit/collaborate controls anywhere on the page —
// covering the full "generate link → view unauthenticated" journey from
// the acceptance criteria.
describe('album public share link journey', async () => {
  const fakeS3: FakeS3Server = await startFakeS3Server()
  process.env.AWS_S3_ENDPOINT = fakeS3.url

  await setup({ browser: true })

  const emailPrefix = `share-link-journey-${Date.now()}`
  const email = `${emailPrefix}@example.com`
  const password = 'Str0ng!Pass'
  const bucket = `share-link-journey-bucket-${Date.now()}`
  const tinyPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

  afterAll(async () => {
    await prisma.albumsOnPhotos.deleteMany({})
    await prisma.album.deleteMany({ where: { admin: { email: { startsWith: emailPrefix } } } })
    await prisma.user.deleteMany({ where: { email: { startsWith: emailPrefix } } })
    await fakeS3.close()
  })

  it('generates a share link and views the album unauthenticated through it', async () => {
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

    const album = await $fetch<{ id: number }>('/api/albums', {
      method: 'POST',
      headers: { cookie: cookieHeader },
      body: { title: 'Beach Trip', description: 'A day at the beach' },
    })

    const photo = await prisma.photo.findFirstOrThrow({ where: { user_id: user.id } })
    await $fetch(`/api/albums/${album.id}/photos/${photo.id}`, { method: 'POST', headers: { cookie: cookieHeader } })

    const adminPage = await createPage('/login', { permissions: ['clipboard-read', 'clipboard-write'] })
    await adminPage.getByLabel('Email').fill(email)
    await adminPage.getByLabel('Password').fill(password)
    await adminPage.getByRole('button', { name: 'Sign in', exact: true }).click()
    await adminPage.waitForURL(url('/'))

    await adminPage.goto(url(`/albums/${album.id}`))
    await adminPage.getByText('Beach Trip').waitFor()

    // "Share" lives behind the "Settings" dropdown menu (see
    // app/pages/albums/[id].vue's settingsItems), not a standalone button.
    await adminPage.getByRole('button', { name: 'Settings' }).click()
    await adminPage.getByRole('menuitem', { name: 'Share' }).click()
    await adminPage.getByRole('dialog').getByRole('button', { name: 'Copy' }).waitFor({ state: 'visible' })
    await adminPage.getByRole('dialog').getByRole('button', { name: 'Copy' }).click()
    await adminPage.getByRole('dialog').getByRole('button', { name: 'Copied!' }).waitFor()

    const shared = await prisma.album.findUniqueOrThrow({ where: { id: album.id } })
    expect(shared.share_token).not.toBeNull()

    await adminPage.close()

    // A fresh, cookie-isolated page: whoever follows the link is
    // anonymous, not the signed-in admin above.
    const visitorPage = await createPage(`/albums/public/${shared.share_token}`)
    await visitorPage.getByRole('heading', { name: 'Beach Trip' }).waitFor()
    await visitorPage.getByText('A day at the beach').waitFor()
    await visitorPage.locator('img[alt^="Photo "]').first().waitFor()

    expect(await visitorPage.getByRole('button', { name: /like/i }).count()).toBe(0)
    expect(await visitorPage.getByRole('button', { name: /delete/i }).count()).toBe(0)
    expect(await visitorPage.getByRole('button', { name: /collaborator/i }).count()).toBe(0)

    await visitorPage.close()
  }, 60_000)
})
