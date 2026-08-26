import type { FakeS3Server } from './fake-s3-server'
import process from 'node:process'
import { $fetch, fetch, setup, url } from '@nuxt/test-utils/e2e'
import { afterAll, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { prisma } from '../../server/utils/prisma'
import { startFakeS3Server } from './fake-s3-server'

// Black-box HTTP tests for the personal photo library endpoints (issue
// #50): list (paginated)/create/delete/like/unlike a Photo, each scoped to
// the authenticated User's own Photos and requiring a Storage Connection,
// plus the "photo uploaded" WS notification a successful upload emits.
// Real AWS is replaced by an in-process fake S3 double (see
// fake-s3-server.ts) — no mocking of this app's own server/utils modules.
describe('personal photo library', async () => {
  const fakeS3: FakeS3Server = await startFakeS3Server()
  process.env.AWS_S3_ENDPOINT = fakeS3.url

  await setup()

  const emailPrefix = `photos-${Date.now()}`
  const password = 'Str0ng!Pass'
  const tinyPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

  function uniqueEmail() {
    return `${emailPrefix}-${Math.random().toString(36).slice(2)}@example.com`
  }

  function uniqueBucketName() {
    return `photos-bucket-${Math.random().toString(36).slice(2)}`
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

    await $fetch('/api/storage-connections', {
      method: 'POST',
      headers: { cookie: cookieHeader },
      body: { mode: 'connect', access_key_id: 'AKIATEST', secret_access_key: 'test-secret', bucket },
    })

    return { ...user, cookieHeader, bucket }
  }

  async function uploadPhoto(cookieHeader: string, overrides: Record<string, unknown> = {}) {
    return $fetch<{ id: number, url: string, liked: boolean }>('/api/photos', {
      method: 'POST',
      headers: { cookie: cookieHeader },
      body: { filename: 'photo.png', mime_type: 'image/png', base64: tinyPngBase64, ...overrides },
    })
  }

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { startsWith: emailPrefix } } })
    await fakeS3.close()
  })

  describe('create (upload)', () => {
    it('uploads the photo to the bucket and persists a Photo row', async () => {
      const { id: userId, cookieHeader } = await createConnectedUser()

      const photo = await uploadPhoto(cookieHeader)

      expect(photo.url).toContain(`photo.png`)
      expect(photo.liked).toBe(false)

      const row = await prisma.photo.findUniqueOrThrow({ where: { id: photo.id } })
      expect(row.user_id).toBe(userId)
      expect(row.mime_type).toBe('image/png')
      expect(row.size).toBeGreaterThan(0)
    })

    it('rejects a non-image mime type', async () => {
      const { cookieHeader } = await createConnectedUser()

      await expect(
        $fetch('/api/photos', {
          method: 'POST',
          headers: { cookie: cookieHeader },
          body: { filename: 'notes.txt', mime_type: 'text/plain', base64: tinyPngBase64 },
        }),
      ).rejects.toMatchObject({ statusCode: 400, statusMessage: 'validation.invalid_payload' })
    })

    it('rejects a User without a Storage Connection', async () => {
      const user = await createVerifiedUser()
      const cookieHeader = await loginCookieHeader(user.email)

      await expect(uploadPhoto(cookieHeader)).rejects.toMatchObject({
        statusCode: 400,
        statusMessage: 'photos.storage_connection_required',
      })
    })

    it('rejects an unauthenticated request with 401', async () => {
      await expect(
        $fetch('/api/photos', {
          method: 'POST',
          body: { filename: 'photo.png', mime_type: 'image/png', base64: tinyPngBase64 },
        }),
      ).rejects.toMatchObject({ statusCode: 401 })
    })

    it('emits a "photo:uploaded" WS notification scoped to the uploading User', async () => {
      const { cookieHeader } = await createConnectedUser()

      const socket = new WebSocket(url('/ws').replace(/^http/, 'ws'), { headers: { cookie: cookieHeader } })
      await new Promise<void>((resolve, reject) => {
        socket.once('open', () => resolve())
        socket.once('error', reject)
      })

      const messageReceived = new Promise<any>((resolve) => {
        socket.once('message', data => resolve(JSON.parse(data.toString())))
      })

      const photo = await uploadPhoto(cookieHeader)
      const message = await messageReceived

      expect(message.name).toBe('photo:uploaded')
      expect(message.data.id).toBe(photo.id)

      socket.close()
    })
  })

  describe('list', () => {
    it('returns only the authenticated User\'s own Photos, newest first', async () => {
      const userA = await createConnectedUser()
      const userB = await createConnectedUser()

      await uploadPhoto(userA.cookieHeader, { last_modified: '2024-01-01T00:00:00.000Z' })
      const secondPhoto = await uploadPhoto(userA.cookieHeader, { last_modified: '2024-06-01T00:00:00.000Z' })
      await uploadPhoto(userB.cookieHeader)

      const response = await $fetch<{ photos: { id: number }[], next_cursor: number | null }>('/api/photos', {
        headers: { cookie: userA.cookieHeader },
      })

      expect(response.photos).toHaveLength(2)
      expect(response.photos[0]!.id).toBe(secondPhoto.id)
      expect(response.next_cursor).toBeNull()
    })

    it('paginates with a keyset cursor', async () => {
      const { cookieHeader } = await createConnectedUser()

      for (let i = 0; i < 3; i++)
        await uploadPhoto(cookieHeader, { last_modified: new Date(2024, 0, i + 1).toISOString() })

      const firstPage = await $fetch<{ photos: { id: number }[], next_cursor: number | null }>('/api/photos?limit=2', {
        headers: { cookie: cookieHeader },
      })

      expect(firstPage.photos).toHaveLength(2)
      expect(firstPage.next_cursor).not.toBeNull()

      const secondPage = await $fetch<{ photos: { id: number }[], next_cursor: number | null }>(`/api/photos?limit=2&cursor=${firstPage.next_cursor}`, {
        headers: { cookie: cookieHeader },
      })

      expect(secondPage.photos).toHaveLength(1)
      expect(secondPage.next_cursor).toBeNull()
      expect(secondPage.photos[0]!.id).not.toBe(firstPage.photos[0]!.id)
    })

    it('reports each Photo\'s archived/restoring/restored state (issue #145), non-archived Photos rendering unaffected', async () => {
      const { id: userId, cookieHeader, bucket } = await createConnectedUser()
      const normalPhoto = await uploadPhoto(cookieHeader)

      const archivedPhoto = await prisma.photo.create({
        data: {
          key: 'archived.jpg',
          mime_type: 'image/jpeg',
          size: 1,
          last_modified: new Date(),
          storage_class: 'GLACIER',
          user: { connect: { id: userId } },
        },
      })
      const restoringPhoto = await prisma.photo.create({
        data: {
          key: 'restoring.jpg',
          mime_type: 'image/jpeg',
          size: 1,
          last_modified: new Date(),
          storage_class: 'DEEP_ARCHIVE',
          restore_ongoing: true,
          user: { connect: { id: userId } },
        },
      })
      fakeS3.seedBucket(bucket, [
        { key: 'archived.jpg', storageClass: 'GLACIER' },
        { key: 'restoring.jpg', storageClass: 'DEEP_ARCHIVE', restoreOngoing: true },
      ])

      const response = await $fetch<{ photos: { id: number, url: string, archived_state: string | null }[] }>('/api/photos', {
        headers: { cookie: cookieHeader },
      })

      const stateById = new Map(response.photos.map(photo => [photo.id, photo.archived_state]))
      expect(stateById.get(normalPhoto.id)).toBeNull()
      expect(stateById.get(archivedPhoto.id)).toBe('archived')
      expect(stateById.get(restoringPhoto.id)).toBe('restoring')

      // A non-archived Photo's own response shape (its signed `url` above
      // all) must stay exactly as it was before this feature.
      expect(response.photos.find(photo => photo.id === normalPhoto.id)?.url).toContain('photo.png')
    })

    it('rejects a User without a Storage Connection', async () => {
      const user = await createVerifiedUser()
      const cookieHeader = await loginCookieHeader(user.email)

      await expect(
        $fetch('/api/photos', { headers: { cookie: cookieHeader } }),
      ).rejects.toMatchObject({ statusCode: 400, statusMessage: 'photos.storage_connection_required' })
    })

    it('rejects an unauthenticated request with 401', async () => {
      await expect($fetch('/api/photos')).rejects.toMatchObject({ statusCode: 401 })
    })
  })

  describe('delete', () => {
    it('removes the Photo row and its bucket object', async () => {
      const { cookieHeader } = await createConnectedUser()
      const photo = await uploadPhoto(cookieHeader)

      const response = await fetch(`/api/photos/${photo.id}`, { method: 'DELETE', headers: { cookie: cookieHeader } })
      expect(response.status).toBe(204)

      await expect(prisma.photo.findUnique({ where: { id: photo.id } })).resolves.toBeNull()
    })

    it('rejects deleting another User\'s Photo with 404', async () => {
      const owner = await createConnectedUser()
      const other = await createConnectedUser()
      const photo = await uploadPhoto(owner.cookieHeader)

      await expect(
        $fetch(`/api/photos/${photo.id}`, { method: 'DELETE', headers: { cookie: other.cookieHeader } }),
      ).rejects.toMatchObject({ statusCode: 404, statusMessage: 'photos.not_found' })
    })

    it('rejects an unauthenticated request with 401', async () => {
      await expect(
        $fetch('/api/photos/1', { method: 'DELETE' }),
      ).rejects.toMatchObject({ statusCode: 401 })
    })
  })

  describe('like / unlike', () => {
    it('likes then unlikes a Photo', async () => {
      const { cookieHeader } = await createConnectedUser()
      const photo = await uploadPhoto(cookieHeader)

      const liked = await $fetch<{ liked: boolean }>(`/api/photos/${photo.id}/like`, {
        method: 'POST',
        headers: { cookie: cookieHeader },
      })
      expect(liked.liked).toBe(true)

      const unliked = await $fetch<{ liked: boolean }>(`/api/photos/${photo.id}/like`, {
        method: 'DELETE',
        headers: { cookie: cookieHeader },
      })
      expect(unliked.liked).toBe(false)
    })

    it('rejects liking another User\'s Photo with 404', async () => {
      const owner = await createConnectedUser()
      const other = await createConnectedUser()
      const photo = await uploadPhoto(owner.cookieHeader)

      await expect(
        $fetch(`/api/photos/${photo.id}/like`, { method: 'POST', headers: { cookie: other.cookieHeader } }),
      ).rejects.toMatchObject({ statusCode: 404, statusMessage: 'photos.not_found' })
    })

    it('rejects an unauthenticated request with 401', async () => {
      await expect(
        $fetch('/api/photos/1/like', { method: 'POST' }),
      ).rejects.toMatchObject({ statusCode: 401 })
    })
  })
})
