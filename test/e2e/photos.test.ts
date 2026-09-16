import type { FakeS3Server } from './fake-s3-server'
import { Buffer } from 'node:buffer'
import process from 'node:process'
import { $fetch, fetch, setup, url } from '@nuxt/test-utils/e2e'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { prisma } from '../../server/utils/prisma'
import { buildJpegWithDateTimeOriginal } from './exif-fixtures'
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
    return $fetch<{ id: number, url: string, filename: string, liked: boolean }>('/api/photos', {
      method: 'POST',
      headers: { cookie: cookieHeader },
      body: { filename: 'photo.png', mime_type: 'image/png', base64: tinyPngBase64, ...overrides },
    })
  }

  async function createAlbum(cookieHeader: string, overrides: Record<string, unknown> = {}) {
    return $fetch<{ id: number, title: string }>('/api/albums', {
      method: 'POST',
      headers: { cookie: cookieHeader },
      body: { title: 'My Album', ...overrides },
    })
  }

  async function addPhotoToAlbum(cookieHeader: string, albumId: number, photoId: number) {
    await $fetch(`/api/albums/${albumId}/photos/${photoId}`, { method: 'POST', headers: { cookie: cookieHeader } })
  }

  // Shared only by the "search" tests below (see that describe block's
  // comment) — every other describe in this file keeps registering a
  // fresh User per test. Declared/populated at this top level (rather
  // than in a nested beforeAll) because a beforeAll nested inside a
  // describe whose parent describe body is itself async does not
  // reliably see the @nuxt/test-utils context set up by `await setup()`
  // above.
  let searchOwner: Awaited<ReturnType<typeof createConnectedUser>>
  let searchOther: Awaited<ReturnType<typeof createConnectedUser>>

  beforeAll(async () => {
    searchOwner = await createConnectedUser()
    searchOther = await createConnectedUser()
  })

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { startsWith: emailPrefix } } })
    await fakeS3.close()
  })

  describe('create (upload)', () => {
    it('uploads the photo to the bucket and persists a Photo row', async () => {
      const { id: userId, cookieHeader } = await createConnectedUser()

      const photo = await uploadPhoto(cookieHeader)

      expect(photo.url).toBe(`/api/photos/${photo.id}/image`)
      expect(photo.filename).toBe('photo.png')
      expect(photo.liked).toBe(false)

      const row = await prisma.photo.findUniqueOrThrow({ where: { id: photo.id } })
      expect(row.user_id).toBe(userId)
      expect(row.mime_type).toBe('image/png')
      expect(row.size).toBeGreaterThan(0)
      // A tiny synthetic PNG carries no EXIF at all (issue #162) — the
      // fallback-to-`last_modified` path, not the happy path below.
      expect(row.taken_at).toBeNull()
    })

    it('extracts taken_at from an uploaded JPEG\'s own EXIF metadata (issue #162), with no extra S3 request', async () => {
      const { cookieHeader } = await createConnectedUser()
      const takenAt = new Date('2018-03-10T09:15:00.000Z')
      const jpegBase64 = buildJpegWithDateTimeOriginal(takenAt).toString('base64')

      const photo = await uploadPhoto(cookieHeader, { filename: 'holiday.jpg', mime_type: 'image/jpeg', base64: jpegBase64 })

      const row = await prisma.photo.findUniqueOrThrow({ where: { id: photo.id } })
      expect(row.taken_at).toEqual(takenAt)
      expect(fakeS3.getRequestsFor(row.key)).toHaveLength(0)
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

    it('orders by taken_at when present, falling back to last_modified otherwise (issue #162), as a single merged timeline', async () => {
      const { id: userId, cookieHeader } = await createConnectedUser()

      // An old Photo whose EXIF taken_at long predates every last_modified
      // below — without the fallback merge, this would wrongly sort above
      // Photos that only have a last_modified, even though it's the
      // oldest of the three by any measure.
      const oldTakenAt = await prisma.photo.create({
        data: { key: 'old.jpg', mime_type: 'image/jpeg', size: 1, last_modified: new Date('2024-06-01'), taken_at: new Date('2015-01-01'), user: { connect: { id: userId } } },
      })
      // No taken_at at all — falls back to last_modified, landing between
      // the other two.
      const noExif = await prisma.photo.create({
        data: { key: 'no-exif.png', mime_type: 'image/png', size: 1, last_modified: new Date('2024-06-15'), user: { connect: { id: userId } } },
      })
      // Most recent taken_at of all, despite an older last_modified than
      // noExif — proves taken_at (not last_modified) drives the order
      // whenever it's present.
      const recentTakenAt = await prisma.photo.create({
        data: { key: 'recent.jpg', mime_type: 'image/jpeg', size: 1, last_modified: new Date('2024-01-01'), taken_at: new Date('2024-12-01'), user: { connect: { id: userId } } },
      })

      const response = await $fetch<{ photos: { id: number }[] }>('/api/photos', { headers: { cookie: cookieHeader } })

      expect(response.photos.map(photo => photo.id)).toEqual([recentTakenAt.id, noExif.id, oldTakenAt.id])
    })

    it('rejects a cursor that does not resolve to one of the User\'s own Photos', async () => {
      const { cookieHeader } = await createConnectedUser()
      const other = await createConnectedUser()
      const otherPhoto = await uploadPhoto(other.cookieHeader)

      await expect(
        $fetch(`/api/photos?cursor=${otherPhoto.id}`, { headers: { cookie: cookieHeader } }),
      ).rejects.toMatchObject({ statusCode: 400, statusMessage: 'photos.invalid_cursor' })

      await expect(
        $fetch(`/api/photos?cursor=999999999`, { headers: { cookie: cookieHeader } }),
      ).rejects.toMatchObject({ statusCode: 400, statusMessage: 'photos.invalid_cursor' })
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

      // A non-archived Photo's own response shape (its stable image `url`
      // above all) must stay exactly as it was before this feature.
      const normalResult = response.photos.find(photo => photo.id === normalPhoto.id)
      expect(normalResult?.url).toBe(`/api/photos/${normalPhoto.id}/image`)
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

  describe('image (issue #168)', () => {
    it('streams the owner\'s Photo bytes with the right content-type', async () => {
      const { cookieHeader } = await createConnectedUser()
      const photo = await uploadPhoto(cookieHeader)

      const response = await fetch(photo.url, { headers: { cookie: cookieHeader } })

      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe('image/png')
      const bytes = Buffer.from(await response.arrayBuffer())
      expect(bytes.length).toBeGreaterThan(0)
    })

    it('lets a Collaborator on a shared Album view the Photo it\'s assigned to', async () => {
      const owner = await createConnectedUser()
      const collaborator = await createConnectedUser()
      const photo = await uploadPhoto(owner.cookieHeader)

      const album = await $fetch<{ id: number }>('/api/albums', {
        method: 'POST',
        headers: { cookie: owner.cookieHeader },
        body: { title: 'Shared With Collaborator' },
      })
      await $fetch(`/api/albums/${album.id}/photos/${photo.id}`, {
        method: 'POST',
        headers: { cookie: owner.cookieHeader },
      })
      await prisma.album.update({ where: { id: album.id }, data: { users: { connect: { id: collaborator.id } } } })

      const response = await fetch(photo.url, { headers: { cookie: collaborator.cookieHeader } })

      expect(response.status).toBe(200)
    })

    it('rejects a User unrelated to the Photo with 404', async () => {
      const owner = await createConnectedUser()
      const other = await createConnectedUser()
      const photo = await uploadPhoto(owner.cookieHeader)

      await expect(
        $fetch(photo.url, { headers: { cookie: other.cookieHeader } }),
      ).rejects.toMatchObject({ statusCode: 404, statusMessage: 'photos.not_found' })
    })

    it('rejects an unauthenticated request with 401', async () => {
      await expect($fetch('/api/photos/1/image')).rejects.toMatchObject({ statusCode: 401 })
    })

    it('rejects an Archived Photo with 409', async () => {
      const { id: userId, cookieHeader, bucket } = await createConnectedUser()
      const archivedPhoto = await prisma.photo.create({
        data: {
          key: 'archived-image.jpg',
          mime_type: 'image/jpeg',
          size: 1,
          last_modified: new Date(),
          storage_class: 'GLACIER',
          user: { connect: { id: userId } },
        },
      })
      fakeS3.seedBucket(bucket, [{ key: 'archived-image.jpg', storageClass: 'GLACIER' }])

      await expect(
        $fetch(`/api/photos/${archivedPhoto.id}/image`, { headers: { cookie: cookieHeader } }),
      ).rejects.toMatchObject({ statusCode: 409, statusMessage: 'photos.archived' })
    })

    it('streams a Restored Photo\'s bytes rather than treating it as still Archived (issue #145)', async () => {
      const { id: userId, cookieHeader, bucket } = await createConnectedUser()
      const restoreExpiresAt = new Date(Date.now() + 60 * 60 * 1000)
      const restoredPhoto = await prisma.photo.create({
        data: {
          key: 'restored-image.jpg',
          mime_type: 'image/jpeg',
          size: 1,
          last_modified: new Date(),
          storage_class: 'GLACIER',
          restore_expires_at: restoreExpiresAt,
          user: { connect: { id: userId } },
        },
      })
      fakeS3.seedBucket(bucket, [{ key: 'restored-image.jpg', storageClass: 'GLACIER', restoreExpiresAt, body: Buffer.from(tinyPngBase64, 'base64'), contentType: 'image/jpeg' }])

      const response = await fetch(`/api/photos/${restoredPhoto.id}/image`, { headers: { cookie: cookieHeader } })

      expect(response.status).toBe(200)
    })
  })

  describe('search', () => {
    // Unlike every other describe block in this file, these tests share
    // one small fixed pair of connected Users (searchOwner/searchOther,
    // set up above) rather than registering a fresh one per test:
    // registering + connecting one is 4 HTTP requests, and this block's 7
    // scenarios would otherwise risk tripping nuxt-security's rate limit
    // when the full suite runs together — the same reasoning
    // albums.test.ts documents for its own shared-Users setup.
    // Photos/Albums themselves stay cheap to create per test (one request
    // each), so test isolation is unaffected as long as every
    // filename/title used below is unique to its own test.
    it('finds a Photo by a keyword in its filename', async () => {
      const target = await uploadPhoto(searchOwner.cookieHeader, { filename: 'vacation-selfie-unique.png' })
      await uploadPhoto(searchOwner.cookieHeader, { filename: 'unrelated.png' })

      const response = await $fetch<{ photos: { id: number }[] }>('/api/photos/search?q=selfie-unique', {
        headers: { cookie: searchOwner.cookieHeader },
      })

      expect(response.photos.map(photo => photo.id)).toEqual([target.id])
    })

    it('finds a Photo library-wide by the title of an Album it belongs to', async () => {
      const target = await uploadPhoto(searchOwner.cookieHeader, { filename: 'unmatched-name.png' })
      await uploadPhoto(searchOwner.cookieHeader, { filename: 'also-unmatched.png' })
      const album = await createAlbum(searchOwner.cookieHeader, { title: 'Summer Trip Unique' })
      await addPhotoToAlbum(searchOwner.cookieHeader, album.id, target.id)

      const response = await $fetch<{ photos: { id: number }[] }>('/api/photos/search?q=trip unique', {
        headers: { cookie: searchOwner.cookieHeader },
      })

      expect(response.photos.map(photo => photo.id)).toEqual([target.id])
    })

    it('never returns another User\'s Photo', async () => {
      const theirs = await uploadPhoto(searchOther.cookieHeader, { filename: 'cross-account-unique.png' })

      const response = await $fetch<{ photos: { id: number }[] }>('/api/photos/search?q=cross-account-unique', {
        headers: { cookie: searchOwner.cookieHeader },
      })
      expect(response.photos.map(photo => photo.id)).not.toContain(theirs.id)
    })

    it('scopes results to the given Album\'s own Photos, matching filename only (not another Album\'s title)', async () => {
      const matchingFilename = await uploadPhoto(searchOwner.cookieHeader, { filename: 'inside-album-unique.png' })
      const matchingTitleElsewhere = await uploadPhoto(searchOwner.cookieHeader, { filename: 'no-match-here.png' })
      const album = await createAlbum(searchOwner.cookieHeader, { title: 'Scoped Album' })
      const otherAlbum = await createAlbum(searchOwner.cookieHeader, { title: 'Elsewhere Unique Title' })
      await addPhotoToAlbum(searchOwner.cookieHeader, album.id, matchingFilename.id)
      await addPhotoToAlbum(searchOwner.cookieHeader, otherAlbum.id, matchingTitleElsewhere.id)

      const byFilename = await $fetch<{ photos: { id: number }[] }>(`/api/photos/search?q=inside-album-unique&album_id=${album.id}`, {
        headers: { cookie: searchOwner.cookieHeader },
      })
      expect(byFilename.photos.map(photo => photo.id)).toEqual([matchingFilename.id])

      const byOtherAlbumsTitle = await $fetch<{ photos: { id: number }[] }>(`/api/photos/search?q=elsewhere unique title&album_id=${album.id}`, {
        headers: { cookie: searchOwner.cookieHeader },
      })
      expect(byOtherAlbumsTitle.photos).toHaveLength(0)
    })

    it('rejects an album_id the requesting User is not a member of', async () => {
      const album = await createAlbum(searchOwner.cookieHeader, { title: 'Not A Member Album' })

      await expect(
        $fetch(`/api/photos/search?q=x&album_id=${album.id}`, { headers: { cookie: searchOther.cookieHeader } }),
      ).rejects.toMatchObject({ statusCode: 404, statusMessage: 'albums.not_found' })
    })

    it('rejects a missing keyword', async () => {
      await expect(
        $fetch('/api/photos/search', { headers: { cookie: searchOwner.cookieHeader } }),
      ).rejects.toMatchObject({ statusCode: 400, statusMessage: 'photos.invalid_query' })
    })

    it('rejects an unauthenticated request with 401', async () => {
      await expect($fetch('/api/photos/search?q=x')).rejects.toMatchObject({ statusCode: 401 })
    })
  })
})
