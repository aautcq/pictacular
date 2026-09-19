import type { FakeS3Server } from './fake-s3-server'
import process from 'node:process'
import { $fetch, fetch, setup } from '@nuxt/test-utils/e2e'
import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '../../server/utils/prisma'
import { badAccessKeyId, startFakeS3Server } from './fake-s3-server'

// Black-box HTTP tests for the Storage Connection onboarding endpoints
// (issue #49): a signed-in, verified User submits an AWS key pair and
// either creates a new bucket or connects an existing one (CORS set up
// either way), and can check whether a connected bucket already has
// images. Real AWS is replaced by an in-process fake S3 double (see
// fake-s3-server.ts) — no mocking of this app's own server/utils modules.
describe('storage connection onboarding', async () => {
  const fakeS3: FakeS3Server = await startFakeS3Server()
  process.env.AWS_S3_ENDPOINT = fakeS3.url

  await setup()

  const emailPrefix = `storage-conn-${Date.now()}`
  const password = 'Str0ng!Pass'

  function uniqueEmail() {
    return `${emailPrefix}-${Math.random().toString(36).slice(2)}@example.com`
  }

  function uniqueBucketName() {
    return `existing-bucket-${Math.random().toString(36).slice(2)}`
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

    return email
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

  async function createConnectedUser(keys: string[] = []) {
    const email = await createVerifiedUser()
    const cookieHeader = await loginCookieHeader(email)
    const bucket = uniqueBucketName()
    fakeS3.seedBucket(bucket, keys)

    await $fetch('/api/storage-connections', {
      method: 'POST',
      headers: { cookie: cookieHeader },
      body: { mode: 'connect', access_key_id: 'AKIATEST', secret_access_key: 'test-secret', bucket },
    })

    const user = await prisma.user.findUniqueOrThrow({ where: { email } })

    return { id: user.id, email, cookieHeader }
  }

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { startsWith: emailPrefix } } })
    await fakeS3.close()
  })

  describe('create a new bucket', () => {
    it('persists a generated bucket + region and reports has_aws_credentials afterwards', async () => {
      const email = await createVerifiedUser()
      const cookieHeader = await loginCookieHeader(email)

      const response = await fetch('/api/storage-connections', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cookie': cookieHeader },
        body: JSON.stringify({ mode: 'create', access_key_id: 'AKIATEST', secret_access_key: 'test-secret' }),
      })

      expect(response.status).toBe(204)

      const user = await prisma.user.findUniqueOrThrow({ where: { email }, include: { aws_credentials: true } })
      expect(user.aws_credentials?.bucket).toMatch(/^pictacular-/)
      expect(user.aws_credentials?.region).toBe('eu-west-3')

      const me = await $fetch<{ has_aws_credentials: boolean }>('/api/users/me', { headers: { cookie: cookieHeader } })
      expect(me.has_aws_credentials).toBe(true)
    })

    it('rejects an invalid AWS key pair with 401', async () => {
      const email = await createVerifiedUser()
      const cookieHeader = await loginCookieHeader(email)

      await expect(
        $fetch('/api/storage-connections', {
          method: 'POST',
          headers: { cookie: cookieHeader },
          body: { mode: 'create', access_key_id: badAccessKeyId, secret_access_key: 'test-secret' },
        }),
      ).rejects.toMatchObject({ statusCode: 401, statusMessage: 'storage.invalid_credentials' })

      await expect(prisma.awsCredentials.findFirst({ where: { user: { email } } })).resolves.toBeNull()
    })
  })

  describe('connect an existing bucket', () => {
    it('persists the named bucket once it is verified reachable', async () => {
      const email = await createVerifiedUser()
      const cookieHeader = await loginCookieHeader(email)
      const bucket = uniqueBucketName()
      fakeS3.seedBucket(bucket)

      const response = await fetch('/api/storage-connections', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cookie': cookieHeader },
        body: JSON.stringify({ mode: 'connect', access_key_id: 'AKIATEST', secret_access_key: 'test-secret', bucket }),
      })

      expect(response.status).toBe(204)

      const user = await prisma.user.findUniqueOrThrow({ where: { email }, include: { aws_credentials: true } })
      expect(user.aws_credentials?.bucket).toBe(bucket)
    })

    it('rejects a bucket that does not exist / is not accessible with 404', async () => {
      const email = await createVerifiedUser()
      const cookieHeader = await loginCookieHeader(email)

      await expect(
        $fetch('/api/storage-connections', {
          method: 'POST',
          headers: { cookie: cookieHeader },
          body: { mode: 'connect', access_key_id: 'AKIATEST', secret_access_key: 'test-secret', bucket: uniqueBucketName() },
        }),
      ).rejects.toMatchObject({ statusCode: 404, statusMessage: 'storage.bucket_not_found' })
    })

    it('rejects an invalid AWS key pair with 401', async () => {
      const email = await createVerifiedUser()
      const cookieHeader = await loginCookieHeader(email)
      const bucket = uniqueBucketName()
      fakeS3.seedBucket(bucket)

      await expect(
        $fetch('/api/storage-connections', {
          method: 'POST',
          headers: { cookie: cookieHeader },
          body: { mode: 'connect', access_key_id: badAccessKeyId, secret_access_key: 'test-secret', bucket },
        }),
      ).rejects.toMatchObject({ statusCode: 401, statusMessage: 'storage.invalid_credentials' })
    })
  })

  describe('validation and access control', () => {
    it('rejects an invalid payload', async () => {
      const email = await createVerifiedUser()
      const cookieHeader = await loginCookieHeader(email)

      await expect(
        $fetch('/api/storage-connections', {
          method: 'POST',
          headers: { cookie: cookieHeader },
          body: { mode: 'connect', access_key_id: 'AKIATEST', secret_access_key: 'test-secret' },
        }),
      ).rejects.toMatchObject({ statusCode: 400, statusMessage: 'validation.invalid_payload' })
    })

    it('rejects a second connection attempt for a User who already has one', async () => {
      const email = await createVerifiedUser()
      const cookieHeader = await loginCookieHeader(email)

      await $fetch('/api/storage-connections', {
        method: 'POST',
        headers: { cookie: cookieHeader },
        body: { mode: 'create', access_key_id: 'AKIATEST', secret_access_key: 'test-secret' },
      })

      await expect(
        $fetch('/api/storage-connections', {
          method: 'POST',
          headers: { cookie: cookieHeader },
          body: { mode: 'create', access_key_id: 'AKIATEST', secret_access_key: 'test-secret' },
        }),
      ).rejects.toMatchObject({ statusCode: 409, statusMessage: 'storage.already_connected' })
    })

    it('rejects an unauthenticated request with 401', async () => {
      await expect(
        $fetch('/api/storage-connections', {
          method: 'POST',
          body: { mode: 'create', access_key_id: 'AKIATEST', secret_access_key: 'test-secret' },
        }),
      ).rejects.toMatchObject({ statusCode: 401 })
    })
  })

  describe('check-bucket', () => {
    it('rejects when the User has no Storage Connection yet', async () => {
      const email = await createVerifiedUser()
      const cookieHeader = await loginCookieHeader(email)

      await expect(
        $fetch('/api/storage-connections/check-bucket', { headers: { cookie: cookieHeader } }),
      ).rejects.toMatchObject({ statusCode: 400, statusMessage: 'storage.connection_required' })
    })

    it('reports has_photos: false for an empty connected bucket', async () => {
      const email = await createVerifiedUser()
      const cookieHeader = await loginCookieHeader(email)
      const bucket = uniqueBucketName()
      fakeS3.seedBucket(bucket)

      await $fetch('/api/storage-connections', {
        method: 'POST',
        headers: { cookie: cookieHeader },
        body: { mode: 'connect', access_key_id: 'AKIATEST', secret_access_key: 'test-secret', bucket },
      })

      const response = await $fetch<{ has_photos: boolean, import_in_progress: boolean, import_completed: boolean }>('/api/storage-connections/check-bucket', {
        headers: { cookie: cookieHeader },
      })

      expect(response.has_photos).toBe(false)
      expect(response.import_in_progress).toBe(false)
      expect(response.import_completed).toBe(false)
    })

    it('reports has_photos: true when the connected bucket already contains image files', async () => {
      const email = await createVerifiedUser()
      const cookieHeader = await loginCookieHeader(email)
      const bucket = uniqueBucketName()
      fakeS3.seedBucket(bucket, ['holiday/beach.jpg', 'notes.txt'])

      await $fetch('/api/storage-connections', {
        method: 'POST',
        headers: { cookie: cookieHeader },
        body: { mode: 'connect', access_key_id: 'AKIATEST', secret_access_key: 'test-secret', bucket },
      })

      const response = await $fetch<{ has_photos: boolean, import_in_progress: boolean, import_completed: boolean }>('/api/storage-connections/check-bucket', {
        headers: { cookie: cookieHeader },
      })

      expect(response.has_photos).toBe(true)
      expect(response.import_in_progress).toBe(false)
      expect(response.import_completed).toBe(false)
    })

    // Issue #203: a "many many photos" import survives a page reload
    // partway through (e.g. the tab being suspended across a laptop going
    // to sleep) since check-bucket reports the persisted, in-flight state
    // straight from the AwsCredentials row the resumable import itself
    // writes to (server/api/photos/import.post.ts) — not just whether the
    // bucket currently has images (always true mid- or post-import).
    it('reports import_in_progress: true while a chunked import is still resuming', async () => {
      const email = await createVerifiedUser()
      const cookieHeader = await loginCookieHeader(email)
      const bucket = uniqueBucketName()
      fakeS3.seedBucket(bucket, ['holiday/beach.jpg'])

      await $fetch('/api/storage-connections', {
        method: 'POST',
        headers: { cookie: cookieHeader },
        body: { mode: 'connect', access_key_id: 'AKIATEST', secret_access_key: 'test-secret', bucket },
      })

      const user = await prisma.user.findUniqueOrThrow({ where: { email } })
      await prisma.awsCredentials.updateMany({
        where: { user_id: user.id },
        data: { import_cursor: 'some-continuation-token', import_total: 5, import_imported: 2 },
      })

      const response = await $fetch<{ import_in_progress: boolean, import_completed: boolean }>('/api/storage-connections/check-bucket', {
        headers: { cookie: cookieHeader },
      })

      expect(response.import_in_progress).toBe(true)
      expect(response.import_completed).toBe(false)
    })

    // Issue #203: once a chunked import finishes, its result is snapshotted
    // permanently (import_completed_at/import_last_imported/
    // import_last_albums — distinct from the working counters, which reset
    // on completion) so a page reload after completion restores the same
    // "already imported" summary instead of re-offering the import step.
    it('reports import_completed: true with the last completed result, after a chunked import finishes', async () => {
      const { id: userId, cookieHeader } = await createConnectedUser(['holiday/beach.jpg', 'holiday/sunset.png'])

      await $fetch('/api/photos/import', { method: 'POST', headers: { cookie: cookieHeader } })

      const response = await $fetch<{ import_in_progress: boolean, import_completed: boolean, imported: number, albums: number }>('/api/storage-connections/check-bucket', {
        headers: { cookie: cookieHeader },
      })

      expect(response.import_in_progress).toBe(false)
      expect(response.import_completed).toBe(true)
      expect(response.imported).toBe(2)
      expect(response.albums).toBe(1)

      const account = await prisma.awsCredentials.findFirstOrThrow({ where: { user_id: userId } })
      expect(account.import_cursor).toBeNull()
      expect(account.import_imported).toBe(0)
    })

    it('rejects an unauthenticated request with 401', async () => {
      await expect(
        $fetch('/api/storage-connections/check-bucket'),
      ).rejects.toMatchObject({ statusCode: 401 })
    })
  })
})
