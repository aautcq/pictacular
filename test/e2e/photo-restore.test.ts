import type { FakeS3Server } from './fake-s3-server'
import process from 'node:process'
import { $fetch, fetch, setup } from '@nuxt/test-utils/e2e'
import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '../../server/utils/prisma'
import { badRoleArn, startFakeS3Server, testExternalId, testRoleArn } from './fake-s3-server'

// Black-box HTTP tests for restoring Archived Photos (issue #145):
// `POST /api/photos/:id/restore` (single) and `POST /api/photos/restore`
// (bulk — every currently Archived Photo the User owns), each checking
// the object's current status first so a restore already in flight or
// already completed is never re-requested. Real AWS is replaced by the
// same in-process fake S3 double photos.test.ts uses (see
// fake-s3-server.ts), extended here with HeadObject/RestoreObject
// support — no mocking of this app's own server/utils modules.
describe('archived photo restore', async () => {
  const fakeS3: FakeS3Server = await startFakeS3Server()
  process.env.AWS_S3_ENDPOINT = fakeS3.url

  await setup()

  const emailPrefix = `photo-restore-${Date.now()}`
  const password = 'Str0ng!Pass'

  function uniqueEmail() {
    return `${emailPrefix}-${Math.random().toString(36).slice(2)}@example.com`
  }

  function uniqueBucketName() {
    return `restore-bucket-${Math.random().toString(36).slice(2)}`
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

  async function createConnectedUser() {
    const user = await createVerifiedUser()
    const cookieHeader = await loginCookieHeader(user.email)
    const bucket = uniqueBucketName()
    fakeS3.seedBucket(bucket)

    await prisma.storageConnection.create({
      data: {
        bucket,
        region: 'eu-west-3',
        role_arn: testRoleArn,
        external_id: testExternalId,
        user: { connect: { id: user.id } },
      },
    })

    return { ...user, cookieHeader, bucket }
  }

  async function createPhotoRow(userId: number, key: string, storageClass: string | null = null) {
    return prisma.photo.create({
      data: {
        key,
        mime_type: 'image/jpeg',
        size: 1,
        last_modified: new Date(),
        storage_class: storageClass,
        user: { connect: { id: userId } },
      },
      include: { likes: { select: { id: true } } },
    })
  }

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { startsWith: emailPrefix } } })
    await fakeS3.close()
  })

  describe('single restore', () => {
    it('requests a restore for an Archived Photo not yet being restored', async () => {
      const { id: userId, cookieHeader, bucket } = await createConnectedUser()
      fakeS3.seedBucket(bucket, [{ key: 'photo.jpg', storageClass: 'GLACIER' }])
      const photo = await createPhotoRow(userId, 'photo.jpg', 'GLACIER')

      const response = await $fetch<{ id: number, archived_state: string | null }>(`/api/photos/${photo.id}/restore`, {
        method: 'POST',
        headers: { cookie: cookieHeader },
      })

      expect(response.archived_state).toBe('restoring')

      const row = await prisma.photo.findUniqueOrThrow({ where: { id: photo.id } })
      expect(row.restore_ongoing).toBe(true)
    })

    it('does not error when the Photo is already being restored (e.g. started directly in AWS)', async () => {
      const { id: userId, cookieHeader, bucket } = await createConnectedUser()
      fakeS3.seedBucket(bucket, [{ key: 'photo.jpg', storageClass: 'GLACIER', restoreOngoing: true }])
      const photo = await createPhotoRow(userId, 'photo.jpg', 'GLACIER')

      const response = await $fetch<{ archived_state: string | null }>(`/api/photos/${photo.id}/restore`, {
        method: 'POST',
        headers: { cookie: cookieHeader },
      })

      expect(response.archived_state).toBe('restoring')
    })

    it('recognizes an already-completed restore rather than re-requesting one', async () => {
      const { id: userId, cookieHeader, bucket } = await createConnectedUser()
      const restoreExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
      fakeS3.seedBucket(bucket, [{ key: 'photo.jpg', storageClass: 'GLACIER', restoreExpiresAt }])
      const photo = await createPhotoRow(userId, 'photo.jpg', 'GLACIER')

      const response = await $fetch<{ archived_state: string | null, restore_expires_at: string | null }>(`/api/photos/${photo.id}/restore`, {
        method: 'POST',
        headers: { cookie: cookieHeader },
      })

      expect(response.archived_state).toBe('restored')
      expect(response.restore_expires_at).toBeTruthy()
    })

    it('rejects restoring a Photo that is not archived', async () => {
      const { id: userId, cookieHeader, bucket } = await createConnectedUser()
      fakeS3.seedBucket(bucket, [{ key: 'photo.jpg', storageClass: 'STANDARD' }])
      const photo = await createPhotoRow(userId, 'photo.jpg')

      await expect(
        $fetch(`/api/photos/${photo.id}/restore`, { method: 'POST', headers: { cookie: cookieHeader } }),
      ).rejects.toMatchObject({ statusCode: 400, statusMessage: 'photos.not_archived' })
    })

    it('rejects restoring another User\'s Photo with 404', async () => {
      const owner = await createConnectedUser()
      const other = await createConnectedUser()
      fakeS3.seedBucket(owner.bucket, [{ key: 'photo.jpg', storageClass: 'GLACIER' }])
      const photo = await createPhotoRow(owner.id, 'photo.jpg', 'GLACIER')

      await expect(
        $fetch(`/api/photos/${photo.id}/restore`, { method: 'POST', headers: { cookie: other.cookieHeader } }),
      ).rejects.toMatchObject({ statusCode: 404, statusMessage: 'photos.not_found' })
    })

    it('rejects a User without a Storage Connection', async () => {
      const user = await createVerifiedUser()
      const cookieHeader = await loginCookieHeader(user.email)

      await expect(
        $fetch('/api/photos/1/restore', { method: 'POST', headers: { cookie: cookieHeader } }),
      ).rejects.toMatchObject({ statusCode: 400, statusMessage: 'photos.storage_connection_required' })
    })

    it('rejects an unauthenticated request with 401', async () => {
      await expect(
        $fetch('/api/photos/1/restore', { method: 'POST' }),
      ).rejects.toMatchObject({ statusCode: 401 })
    })

    it('marks the Storage Connection broken (issue #153) and blocks the request, rather than surfacing an unrelated 502', async () => {
      const { id: userId, cookieHeader, bucket } = await createConnectedUser()
      fakeS3.seedBucket(bucket, [{ key: 'photo.jpg', storageClass: 'GLACIER' }])
      const photo = await createPhotoRow(userId, 'photo.jpg', 'GLACIER')

      // Revoking the Storage Connection's Role after the fact (rather
      // than at connect time) simulates a User deleting/breaking the
      // CloudFormation stack that created it — the fake STS double
      // rejects AssumeRole for this sentinel Role ARN (see
      // fake-s3-server.ts), the same AssumeRole failure a real revoked
      // Role now produces.
      await prisma.storageConnection.update({
        where: { user_id: userId },
        data: { role_arn: badRoleArn },
      })

      await expect(
        $fetch(`/api/photos/${photo.id}/restore`, { method: 'POST', headers: { cookie: cookieHeader } }),
      ).rejects.toMatchObject({ statusCode: 403, statusMessage: 'storage.connection_broken' })

      const connection = await prisma.storageConnection.findUniqueOrThrow({ where: { user_id: userId } })
      expect(connection.broken).toBe(true)
    })
  })

  describe('bulk restore', () => {
    it('restores every currently Archived Photo owned by the User, leaving others untouched', async () => {
      const { id: userId, cookieHeader, bucket } = await createConnectedUser()
      fakeS3.seedBucket(bucket, [
        { key: 'a.jpg', storageClass: 'GLACIER' },
        { key: 'b.jpg', storageClass: 'DEEP_ARCHIVE' },
        { key: 'c.jpg', storageClass: 'STANDARD' },
      ])
      const photoA = await createPhotoRow(userId, 'a.jpg', 'GLACIER')
      const photoB = await createPhotoRow(userId, 'b.jpg', 'DEEP_ARCHIVE')
      const photoC = await createPhotoRow(userId, 'c.jpg', 'STANDARD')

      const response = await $fetch<{ restored: number, photos: { id: number, archived_state: string | null }[] }>('/api/photos/restore', {
        method: 'POST',
        headers: { cookie: cookieHeader },
      })

      expect(response.restored).toBe(2)
      expect(response.photos.map(photo => photo.id).sort()).toEqual([photoA.id, photoB.id].sort())

      const rowC = await prisma.photo.findUniqueOrThrow({ where: { id: photoC.id } })
      expect(rowC.restore_ongoing).toBe(false)
    })

    it('does not restore a Photo that is already restoring or restored', async () => {
      const { id: userId, cookieHeader, bucket } = await createConnectedUser()
      fakeS3.seedBucket(bucket, [{ key: 'a.jpg', storageClass: 'GLACIER' }])
      const photo = await createPhotoRow(userId, 'a.jpg', 'GLACIER')
      await prisma.photo.update({ where: { id: photo.id }, data: { restore_ongoing: true } })

      const response = await $fetch<{ restored: number }>('/api/photos/restore', {
        method: 'POST',
        headers: { cookie: cookieHeader },
      })

      expect(response.restored).toBe(0)
    })

    it('rejects a User without a Storage Connection', async () => {
      const user = await createVerifiedUser()
      const cookieHeader = await loginCookieHeader(user.email)

      await expect(
        $fetch('/api/photos/restore', { method: 'POST', headers: { cookie: cookieHeader } }),
      ).rejects.toMatchObject({ statusCode: 400, statusMessage: 'photos.storage_connection_required' })
    })

    it('rejects an unauthenticated request with 401', async () => {
      await expect(
        $fetch('/api/photos/restore', { method: 'POST' }),
      ).rejects.toMatchObject({ statusCode: 401 })
    })
  })
})
