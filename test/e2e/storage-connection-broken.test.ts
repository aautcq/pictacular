import type { FakeS3Server } from './fake-s3-server'
import process from 'node:process'
import { $fetch, fetch, setup } from '@nuxt/test-utils/e2e'
import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '../../server/utils/prisma'
import { badRoleArn, startFakeS3Server, testExternalId, testRoleArn, throttledRoleArn } from './fake-s3-server'

// Black-box HTTP tests for reactive broken-connection detection (issue
// #153): no scheduled job ever polls a User's Role for validity — instead,
// the next real photo action that needs the bucket and hits an
// AssumeRole failure (a deleted/revoked CloudFormation stack, simulated
// here by the fake STS double's badRoleArn sentinel, see
// fake-s3-server.ts) marks that User's Storage Connection `broken`, and
// every subsequent photo-related action is hard-blocked with the same
// `storage.connection_broken` error, rather than each one failing
// individually with an unrelated AWS-level error. Real AWS is replaced by
// the same in-process fake S3 double every other Storage Connection spec
// uses — no mocking of this app's own server/utils modules.
describe('reactive broken Storage Connection detection', async () => {
  const fakeS3: FakeS3Server = await startFakeS3Server()
  process.env.AWS_S3_ENDPOINT = fakeS3.url

  await setup()

  const emailPrefix = `storage-broken-${Date.now()}`
  const password = 'Str0ng!Pass'
  const tinyPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

  function uniqueEmail() {
    return `${emailPrefix}-${Math.random().toString(36).slice(2)}@example.com`
  }

  function uniqueBucketName() {
    return `broken-bucket-${Math.random().toString(36).slice(2)}`
  }

  async function createVerifiedUser() {
    const email = uniqueEmail()
    await $fetch('/api/auth/users', {
      method: 'POST',
      body: {
        email,
        first_name: 'John',
        last_name: 'Doe',
        password,
        password_confirmation: password,
      },
    })

    const user = await prisma.user.findUniqueOrThrow({ where: { email } })
    await $fetch(`/api/auth/verify/${user.verification_token}`)

    return { id: user.id, email }
  }

  async function loginCookieHeader(email: string) {
    const loginResponse = await fetch('/api/auth/sessions', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
      headers: { 'content-type': 'application/json' },
    })

    return loginResponse.headers.getSetCookie()
      .map(cookie => cookie.split(';')[0])
      .join('; ')
  }

  async function createConnectedUser(roleArn: string = testRoleArn) {
    const user = await createVerifiedUser()
    const cookieHeader = await loginCookieHeader(user.email)
    const bucket = uniqueBucketName()
    fakeS3.seedBucket(bucket)

    await prisma.storageConnection.create({
      data: {
        bucket,
        region: 'eu-west-3',
        role_arn: roleArn,
        external_id: testExternalId,
        user: { connect: { id: user.id } },
      },
    })

    return { ...user, cookieHeader, bucket }
  }

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { startsWith: emailPrefix } } })
    await fakeS3.close()
  })

  it('marks the connection broken when an upload hits an unassumable Role, and hard-blocks the next request', async () => {
    const { id: userId, cookieHeader } = await createConnectedUser(badRoleArn)

    await expect(
      $fetch('/api/photos', {
        method: 'POST',
        headers: { cookie: cookieHeader },
        body: { filename: 'photo.png', mime_type: 'image/png', base64: tinyPngBase64 },
      }),
    ).rejects.toMatchObject({ statusCode: 403, statusMessage: 'storage.connection_broken' })

    const connection = await prisma.storageConnection.findUniqueOrThrow({ where: { user_id: userId } })
    expect(connection.broken).toBe(true)

    // A second, unrelated photo action (listing, not uploading) is
    // blocked immediately from the persisted `broken` flag alone — no
    // second AssumeRole round trip needed to reach the same conclusion.
    await expect(
      $fetch('/api/photos', { headers: { cookie: cookieHeader } }),
    ).rejects.toMatchObject({ statusCode: 403, statusMessage: 'storage.connection_broken' })
  })

  it('hard-blocks viewing a Photo once its owner\'s connection is broken', async () => {
    const { id: userId, cookieHeader, bucket } = await createConnectedUser()
    fakeS3.seedBucket(bucket, [{ key: 'photo.jpg' }])
    const photo = await prisma.photo.create({
      data: {
        key: 'photo.jpg',
        mime_type: 'image/jpeg',
        size: 1,
        last_modified: new Date(),
        user: { connect: { id: userId } },
      },
    })

    await prisma.storageConnection.update({ where: { user_id: userId }, data: { role_arn: badRoleArn } })

    await expect(
      $fetch(`/api/photos/${photo.id}/image`, { headers: { cookie: cookieHeader } }),
    ).rejects.toMatchObject({ statusCode: 403, statusMessage: 'storage.connection_broken' })

    const connection = await prisma.storageConnection.findUniqueOrThrow({ where: { user_id: userId } })
    expect(connection.broken).toBe(true)
  })

  it('does not mark the connection broken for an unrelated, non-Role failure', async () => {
    const { id: userId, cookieHeader } = await createConnectedUser()

    // A 404 for a Photo that doesn't exist is a genuine, unrelated
    // failure — never an AssumeRole/Role-validity problem — and must
    // never flip the connection broken.
    await expect(
      $fetch('/api/photos/999999999', { method: 'DELETE', headers: { cookie: cookieHeader } }),
    ).rejects.toMatchObject({ statusCode: 404, statusMessage: 'photos.not_found' })

    const connection = await prisma.storageConnection.findUniqueOrThrow({ where: { user_id: userId } })
    expect(connection.broken).toBe(false)
  })

  it('does not mark the connection broken for a transient, non-Role STS failure', async () => {
    // throttledRoleArn (see fake-s3-server.ts) fails AssumeRole with a
    // genuine STS `ThrottlingException`, never `AccessDenied` — the
    // "not on transient/network errors" half of issue #153's acceptance
    // criteria this asserts directly.
    const { id: userId, cookieHeader } = await createConnectedUser(throttledRoleArn)

    await expect(
      $fetch('/api/photos', {
        method: 'POST',
        headers: { cookie: cookieHeader },
        body: { filename: 'photo.png', mime_type: 'image/png', base64: tinyPngBase64 },
      }),
    ).rejects.toMatchObject({ statusCode: 502, statusMessage: 'storage.connection_unavailable' })

    const connection = await prisma.storageConnection.findUniqueOrThrow({ where: { user_id: userId } })
    expect(connection.broken).toBe(false)
  })

  it('surfaces the broken connection on GET /api/users/me so the client can offer the reconnect flow', async () => {
    const { cookieHeader } = await createConnectedUser(badRoleArn)

    // Trigger the broken flag via a real action first (issue #153 sets
    // it reactively, never proactively) — GET /api/photos itself makes no
    // S3 call, so an upload (which does) is what actually surfaces the
    // AssumeRole failure here.
    await expect(
      $fetch('/api/photos', {
        method: 'POST',
        headers: { cookie: cookieHeader },
        body: { filename: 'photo.png', mime_type: 'image/png', base64: tinyPngBase64 },
      }),
    ).rejects.toThrow()

    const me = await $fetch<{ has_storage_connection: boolean, storage_connection_broken: boolean }>('/api/users/me', {
      headers: { cookie: cookieHeader },
    })

    expect(me.has_storage_connection).toBe(true)
    expect(me.storage_connection_broken).toBe(true)
  })
})
