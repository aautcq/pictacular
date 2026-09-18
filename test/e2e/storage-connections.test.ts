import type { FakeS3Server } from './fake-s3-server'
import process from 'node:process'
import { $fetch, fetch, setup } from '@nuxt/test-utils/e2e'
import { afterAll, describe, expect, it } from 'vitest'
import { encodeStorageConnectionLaunch } from '../../server/utils/jwt'
import { prisma } from '../../server/utils/prisma'
import { badRoleArn, startFakeS3Server, testExternalId, testRoleArn } from './fake-s3-server'

// Black-box HTTP tests for the Storage Connection onboarding endpoints
// (issues #150/#152): a signed-in, verified User supplies their AWS
// Account ID (POST .../launch) — plus, for "connect an existing bucket"
// mode, that bucket's own name — and is handed a pre-filled
// CloudFormation "Launch Stack" URL + a signed `pending_token` recording
// the bucket/Role ARN/External ID/mode Pictacular generated. Once they
// say they've run the stack, they redeem that token (POST
// /api/storage-connections) to have Pictacular verify the Role is really
// assumable and the bucket really exists before persisting the
// connection. Real AWS is replaced by an in-process fake S3 + STS double
// (see fake-s3-server.ts) — no mocking of this app's own server/utils
// modules.
describe('storage connection onboarding', async () => {
  const fakeS3: FakeS3Server = await startFakeS3Server()
  process.env.AWS_S3_ENDPOINT = fakeS3.url

  await setup()

  const emailPrefix = `storage-conn-${Date.now()}`
  const password = 'Str0ng!Pass'
  const awsAccountId = '123456789012'

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

    return user
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
    const user = await createVerifiedUser()
    const cookieHeader = await loginCookieHeader(user.email)
    const bucket = uniqueBucketName()
    fakeS3.seedBucket(bucket, keys)

    await prisma.awsCredentials.create({
      data: {
        bucket,
        region: 'eu-west-3',
        role_arn: testRoleArn,
        external_id: testExternalId,
        user: { connect: { id: user.id } },
      },
    })

    return { id: user.id, email: user.email, cookieHeader }
  }

  // The Launch Stack URL's own stack parameters live inside its URL
  // fragment, not its top-level query string (see
  // server/api/storage-connections/launch.post.ts) — this pulls a single
  // `param_*` value back out for assertions/simulating CloudFormation.
  function launchUrlParam(launchUrl: string, name: string) {
    const query = launchUrl.split('#')[1]?.split('?')[1] ?? ''
    return new URLSearchParams(query).get(name)
  }

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { startsWith: emailPrefix } } })
    await fakeS3.close()
  })

  describe('launch', () => {
    it('generates a bucket/role/external id and returns a pre-filled Launch Stack URL + pending token', async () => {
      const user = await createVerifiedUser()
      const cookieHeader = await loginCookieHeader(user.email)

      const response = await $fetch<{ launch_url: string, pending_token: string }>('/api/storage-connections/launch', {
        method: 'POST',
        headers: { cookie: cookieHeader },
        body: { mode: 'create', aws_account_id: awsAccountId },
      })

      expect(response.launch_url).toContain('cloudformation')
      expect(launchUrlParam(response.launch_url, 'param_BucketName')).toMatch(/^pictacular-/)
      expect(launchUrlParam(response.launch_url, 'param_RoleName')).toMatch(/^pictacular-storage-/)
      expect(launchUrlParam(response.launch_url, 'param_ExternalId')).toBeTruthy()
      expect(response.pending_token).toBeTruthy()

      await expect(prisma.awsCredentials.findFirst({ where: { user_id: user.id } })).resolves.toBeNull()
    })

    it('rejects an AWS Account ID that is not exactly 12 digits', async () => {
      const user = await createVerifiedUser()
      const cookieHeader = await loginCookieHeader(user.email)

      await expect(
        $fetch('/api/storage-connections/launch', {
          method: 'POST',
          headers: { cookie: cookieHeader },
          body: { mode: 'create', aws_account_id: '123' },
        }),
      ).rejects.toMatchObject({ statusCode: 400, statusMessage: 'validation.invalid_payload' })
    })

    it('rejects a second launch for a User who already has a Storage Connection', async () => {
      const user = await createVerifiedUser()
      const cookieHeader = await loginCookieHeader(user.email)
      const bucket = uniqueBucketName()
      fakeS3.seedBucket(bucket)
      await prisma.awsCredentials.create({
        data: { bucket, region: 'eu-west-3', role_arn: testRoleArn, external_id: testExternalId, user: { connect: { id: user.id } } },
      })

      await expect(
        $fetch('/api/storage-connections/launch', {
          method: 'POST',
          headers: { cookie: cookieHeader },
          body: { mode: 'create', aws_account_id: awsAccountId },
        }),
      ).rejects.toMatchObject({ statusCode: 409, statusMessage: 'storage.already_connected' })
    })

    it('rejects an unauthenticated request with 401', async () => {
      await expect(
        $fetch('/api/storage-connections/launch', { method: 'POST', body: { mode: 'create', aws_account_id: awsAccountId } }),
      ).rejects.toMatchObject({ statusCode: 401 })
    })
  })

  describe('confirm', () => {
    it('persists the generated bucket/role/external id once the Role is assumable and the bucket exists', async () => {
      const user = await createVerifiedUser()
      const cookieHeader = await loginCookieHeader(user.email)

      const { launch_url: launchUrl, pending_token: pendingToken } = await $fetch<{ launch_url: string, pending_token: string }>('/api/storage-connections/launch', {
        method: 'POST',
        headers: { cookie: cookieHeader },
        body: { mode: 'create', aws_account_id: awsAccountId },
      })
      const bucket = launchUrlParam(launchUrl, 'param_BucketName')!
      // Simulates the CloudFormation stack the User launched having
      // finished creating the bucket (and Role, which the fake STS double
      // accepts AssumeRole for regardless of ARN unless it's the
      // badRoleArn sentinel — see fake-s3-server.ts).
      fakeS3.seedBucket(bucket)

      const response = await fetch('/api/storage-connections', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cookie': cookieHeader },
        body: JSON.stringify({ pending_token: pendingToken }),
      })

      expect(response.status).toBe(204)

      const persisted = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, include: { aws_credentials: true } })
      expect(persisted.aws_credentials?.bucket).toBe(bucket)
      expect(persisted.aws_credentials?.role_arn).toBe(`arn:aws:iam::${awsAccountId}:role/${launchUrlParam(launchUrl, 'param_RoleName')}`)
      expect(persisted.aws_credentials?.region).toBe('eu-west-3')

      const me = await $fetch<{ has_aws_credentials: boolean }>('/api/users/me', { headers: { cookie: cookieHeader } })
      expect(me.has_aws_credentials).toBe(true)
    })

    it('rejects with 502 when the stack has not finished creating the bucket yet', async () => {
      const user = await createVerifiedUser()
      const cookieHeader = await loginCookieHeader(user.email)

      const { pending_token: pendingToken } = await $fetch<{ pending_token: string }>('/api/storage-connections/launch', {
        method: 'POST',
        headers: { cookie: cookieHeader },
        body: { mode: 'create', aws_account_id: awsAccountId },
      })
      // Bucket deliberately never seeded — the stack "hasn't finished yet".

      await expect(
        $fetch('/api/storage-connections', {
          method: 'POST',
          headers: { cookie: cookieHeader },
          body: { pending_token: pendingToken },
        }),
      ).rejects.toMatchObject({ statusCode: 502, statusMessage: 'storage.bucket_not_ready' })
    })

    it('rejects with 401 when the generated Role is not assumable', async () => {
      const user = await createVerifiedUser()
      const cookieHeader = await loginCookieHeader(user.email)
      const bucket = uniqueBucketName()
      fakeS3.seedBucket(bucket)
      const pendingToken = encodeStorageConnectionLaunch({ user_id: user.id, external_id: testExternalId, bucket, role_arn: badRoleArn, mode: 'create' })

      await expect(
        $fetch('/api/storage-connections', {
          method: 'POST',
          headers: { cookie: cookieHeader },
          body: { pending_token: pendingToken },
        }),
      ).rejects.toMatchObject({ statusCode: 401, statusMessage: 'storage.invalid_role' })
    })

    it('rejects an invalid/tampered pending token with 400', async () => {
      const user = await createVerifiedUser()
      const cookieHeader = await loginCookieHeader(user.email)

      await expect(
        $fetch('/api/storage-connections', {
          method: 'POST',
          headers: { cookie: cookieHeader },
          body: { pending_token: 'not-a-real-token' },
        }),
      ).rejects.toMatchObject({ statusCode: 400, statusMessage: 'storage.invalid_pending_token' })
    })

    it('rejects a pending token issued for a different User with 400', async () => {
      const user = await createVerifiedUser()
      const otherUser = await createVerifiedUser()
      const cookieHeader = await loginCookieHeader(user.email)
      const bucket = uniqueBucketName()
      fakeS3.seedBucket(bucket)
      const pendingToken = encodeStorageConnectionLaunch({ user_id: otherUser.id, external_id: testExternalId, bucket, role_arn: testRoleArn, mode: 'create' })

      await expect(
        $fetch('/api/storage-connections', {
          method: 'POST',
          headers: { cookie: cookieHeader },
          body: { pending_token: pendingToken },
        }),
      ).rejects.toMatchObject({ statusCode: 400, statusMessage: 'storage.invalid_pending_token' })
    })

    it('rejects a second connection attempt for a User who already has one', async () => {
      const user = await createVerifiedUser()
      const cookieHeader = await loginCookieHeader(user.email)
      const bucket = uniqueBucketName()
      fakeS3.seedBucket(bucket)
      await prisma.awsCredentials.create({
        data: { bucket, region: 'eu-west-3', role_arn: testRoleArn, external_id: testExternalId, user: { connect: { id: user.id } } },
      })
      const secondBucket = uniqueBucketName()
      fakeS3.seedBucket(secondBucket)
      const pendingToken = encodeStorageConnectionLaunch({ user_id: user.id, external_id: testExternalId, bucket: secondBucket, role_arn: testRoleArn, mode: 'create' })

      await expect(
        $fetch('/api/storage-connections', {
          method: 'POST',
          headers: { cookie: cookieHeader },
          body: { pending_token: pendingToken },
        }),
      ).rejects.toMatchObject({ statusCode: 409, statusMessage: 'storage.already_connected' })
    })

    it('rejects an invalid payload', async () => {
      const user = await createVerifiedUser()
      const cookieHeader = await loginCookieHeader(user.email)

      await expect(
        $fetch('/api/storage-connections', {
          method: 'POST',
          headers: { cookie: cookieHeader },
          body: {},
        }),
      ).rejects.toMatchObject({ statusCode: 400, statusMessage: 'validation.invalid_payload' })
    })

    it('rejects an unauthenticated request with 401', async () => {
      await expect(
        $fetch('/api/storage-connections', { method: 'POST', body: { pending_token: 'whatever' } }),
      ).rejects.toMatchObject({ statusCode: 401 })
    })
  })

  describe('check-bucket', () => {
    it('rejects when the User has no Storage Connection yet', async () => {
      const user = await createVerifiedUser()
      const cookieHeader = await loginCookieHeader(user.email)

      await expect(
        $fetch('/api/storage-connections/check-bucket', { headers: { cookie: cookieHeader } }),
      ).rejects.toMatchObject({ statusCode: 400, statusMessage: 'storage.connection_required' })
    })

    it('reports has_photos: false for an empty connected bucket', async () => {
      const user = await createVerifiedUser()
      const cookieHeader = await loginCookieHeader(user.email)
      const bucket = uniqueBucketName()
      fakeS3.seedBucket(bucket)
      await prisma.awsCredentials.create({
        data: { bucket, region: 'eu-west-3', role_arn: testRoleArn, external_id: testExternalId, user: { connect: { id: user.id } } },
      })

      const response = await $fetch<{ has_photos: boolean, import_in_progress: boolean, import_completed: boolean }>('/api/storage-connections/check-bucket', {
        headers: { cookie: cookieHeader },
      })

      expect(response.has_photos).toBe(false)
      expect(response.import_in_progress).toBe(false)
      expect(response.import_completed).toBe(false)
    })

    it('reports has_photos: true when the connected bucket already contains image files', async () => {
      const user = await createVerifiedUser()
      const cookieHeader = await loginCookieHeader(user.email)
      const bucket = uniqueBucketName()
      fakeS3.seedBucket(bucket, ['holiday/beach.jpg', 'notes.txt'])
      await prisma.awsCredentials.create({
        data: { bucket, region: 'eu-west-3', role_arn: testRoleArn, external_id: testExternalId, user: { connect: { id: user.id } } },
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
      const user = await createVerifiedUser()
      const cookieHeader = await loginCookieHeader(user.email)
      const bucket = uniqueBucketName()
      fakeS3.seedBucket(bucket, ['holiday/beach.jpg'])

      await prisma.awsCredentials.create({
        data: {
          bucket,
          region: 'eu-west-3',
          role_arn: testRoleArn,
          external_id: testExternalId,
          user: { connect: { id: user.id } },
        },
      })

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

  // "Connect an existing bucket" mode (issue #152): the User names their
  // own bucket up front (POST .../launch's `bucket`), rather than
  // Pictacular generating one, and CloudFormation's Role is scoped to
  // that named bucket via connect-bucket.yaml (issue #151) instead of
  // create-bucket.yaml. The confirm step's behavior differs from
  // "create" in exactly the two ways this ticket calls out: an
  // unreachable/nonexistent bucket is a 404 (the User named the wrong
  // bucket) rather than a 502 "stack still creating", and the bucket's
  // region is always looked up for real rather than assumed to be the
  // stack's own launch region.
  describe('connect an existing bucket', () => {
    it('generates a role/external id (no bucket) and returns a pre-filled Launch Stack URL for the named bucket', async () => {
      const user = await createVerifiedUser()
      const cookieHeader = await loginCookieHeader(user.email)
      const bucket = uniqueBucketName()

      const response = await $fetch<{ launch_url: string, pending_token: string }>('/api/storage-connections/launch', {
        method: 'POST',
        headers: { cookie: cookieHeader },
        body: { mode: 'connect', aws_account_id: awsAccountId, bucket },
      })

      expect(response.launch_url).toContain('cloudformation')
      expect(launchUrlParam(response.launch_url, 'param_BucketName')).toBe(bucket)
      expect(launchUrlParam(response.launch_url, 'param_RoleName')).toMatch(/^pictacular-storage-/)
      expect(launchUrlParam(response.launch_url, 'param_ExternalId')).toBeTruthy()
      expect(response.pending_token).toBeTruthy()
    })

    it('rejects a launch with no bucket name', async () => {
      const user = await createVerifiedUser()
      const cookieHeader = await loginCookieHeader(user.email)

      await expect(
        $fetch('/api/storage-connections/launch', {
          method: 'POST',
          headers: { cookie: cookieHeader },
          body: { mode: 'connect', aws_account_id: awsAccountId, bucket: '' },
        }),
      ).rejects.toMatchObject({ statusCode: 400, statusMessage: 'validation.invalid_payload' })
    })

    it('persists the named bucket/role/external id and its real (non-launch-region) region once the Role is assumable and the bucket exists', async () => {
      const user = await createVerifiedUser()
      const cookieHeader = await loginCookieHeader(user.email)
      const bucket = uniqueBucketName()
      // Seeded region is 'eu-west-3' (see fake-s3-server.ts's GetBucketLocation
      // handler), deliberately not CREATE_BUCKET_STACK_REGION ('us-east-1') —
      // asserting on it distinguishes a real lookup from an assumed default.
      fakeS3.seedBucket(bucket)

      const { pending_token: pendingToken } = await $fetch<{ pending_token: string }>('/api/storage-connections/launch', {
        method: 'POST',
        headers: { cookie: cookieHeader },
        body: { mode: 'connect', aws_account_id: awsAccountId, bucket },
      })

      const response = await fetch('/api/storage-connections', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cookie': cookieHeader },
        body: JSON.stringify({ pending_token: pendingToken }),
      })

      expect(response.status).toBe(204)

      const persisted = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, include: { aws_credentials: true } })
      expect(persisted.aws_credentials?.bucket).toBe(bucket)
      expect(persisted.aws_credentials?.region).toBe('eu-west-3')
    })

    it('rejects with 404 when the named bucket does not exist/is not reachable', async () => {
      const user = await createVerifiedUser()
      const cookieHeader = await loginCookieHeader(user.email)
      const bucket = uniqueBucketName()
      // Bucket deliberately never seeded — the User named a bucket Pictacular
      // (via the assumed Role) can't actually reach.

      const { pending_token: pendingToken } = await $fetch<{ pending_token: string }>('/api/storage-connections/launch', {
        method: 'POST',
        headers: { cookie: cookieHeader },
        body: { mode: 'connect', aws_account_id: awsAccountId, bucket },
      })

      await expect(
        $fetch('/api/storage-connections', {
          method: 'POST',
          headers: { cookie: cookieHeader },
          body: { pending_token: pendingToken },
        }),
      ).rejects.toMatchObject({ statusCode: 404, statusMessage: 'storage.bucket_not_found' })
    })

    it('rejects with 401 when the generated Role is not assumable', async () => {
      const user = await createVerifiedUser()
      const cookieHeader = await loginCookieHeader(user.email)
      const bucket = uniqueBucketName()
      fakeS3.seedBucket(bucket)
      const pendingToken = encodeStorageConnectionLaunch({ user_id: user.id, external_id: testExternalId, bucket, role_arn: badRoleArn, mode: 'connect' })

      await expect(
        $fetch('/api/storage-connections', {
          method: 'POST',
          headers: { cookie: cookieHeader },
          body: { pending_token: pendingToken },
        }),
      ).rejects.toMatchObject({ statusCode: 401, statusMessage: 'storage.invalid_role' })
    })

    it('still detects existing photos and offers the import flow against the newly Role-based connection', async () => {
      const user = await createVerifiedUser()
      const cookieHeader = await loginCookieHeader(user.email)
      const bucket = uniqueBucketName()
      fakeS3.seedBucket(bucket, ['holiday/beach.jpg', 'notes.txt'])

      const { pending_token: pendingToken } = await $fetch<{ pending_token: string }>('/api/storage-connections/launch', {
        method: 'POST',
        headers: { cookie: cookieHeader },
        body: { mode: 'connect', aws_account_id: awsAccountId, bucket },
      })
      await $fetch('/api/storage-connections', {
        method: 'POST',
        headers: { cookie: cookieHeader },
        body: { pending_token: pendingToken },
      })

      const response = await $fetch<{ has_photos: boolean }>('/api/storage-connections/check-bucket', {
        headers: { cookie: cookieHeader },
      })

      expect(response.has_photos).toBe(true)
    })
  })
})
