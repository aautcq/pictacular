import type { FakeS3Server } from './fake-s3-server'
import process from 'node:process'
import { $fetch, fetch, setup } from '@nuxt/test-utils/e2e'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../../server/utils/prisma'
import { startFakeS3Server, testExternalId, testRoleArn } from './fake-s3-server'

// Black-box HTTP tests for the Album core endpoints (issue #51): create,
// list (paginated), search, full show, lightweight show, update,
// delete (admin-only), and add/remove a Photo, each scoped to the
// authenticated User's own membership. Real AWS is replaced by an
// in-process fake S3 double (see fake-s3-server.ts), matching the pattern
// already used by photos.test.ts — no mocking of this app's own server/utils
// modules.
//
// Unlike photos.test.ts, this suite shares a small, fixed set of connected
// Users (created once in beforeAll) across every test rather than
// registering a fresh one per test: registering a User is 4 HTTP requests
// (register, verify, login, storage connection), and this suite's ~25
// scenarios would otherwise comfortably exceed nuxt-security's default
// 150-requests-per-5-minutes rate limit. Albums/Photos themselves stay
// cheap to create per test, so isolation where it matters (e.g. a fresh
// Album per mutation test) is unaffected.
describe('albums core', async () => {
  const fakeS3: FakeS3Server = await startFakeS3Server()
  process.env.AWS_S3_ENDPOINT = fakeS3.url

  await setup()

  const emailPrefix = `albums-${Date.now()}`
  const password = 'Str0ng!Pass'
  const tinyPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

  function uniqueEmail(label: string) {
    return `${emailPrefix}-${label}@example.com`
  }

  function uniqueBucketName(label: string) {
    return `albums-bucket-${label}-${Math.random().toString(36).slice(2)}`
  }

  async function createVerifiedUser(label: string) {
    const email = uniqueEmail(label)
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

  async function createConnectedUser(label: string) {
    const user = await createVerifiedUser(label)
    const cookieHeader = await loginCookieHeader(user.email)
    const bucket = uniqueBucketName(label)
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

    return { ...user, cookieHeader }
  }

  async function createAlbum(cookieHeader: string, overrides: Record<string, unknown> = {}) {
    return $fetch<{ id: number, title: string, description: string | null, cover: string | null, photo_count: number }>('/api/albums', {
      method: 'POST',
      headers: { cookie: cookieHeader },
      body: { title: 'My Album', description: 'A description', ...overrides },
    })
  }

  async function uploadPhoto(cookieHeader: string, overrides: Record<string, unknown> = {}) {
    return $fetch<{ id: number, url: string }>('/api/photos', {
      method: 'POST',
      headers: { cookie: cookieHeader },
      body: { filename: 'photo.png', mime_type: 'image/png', base64: tinyPngBase64, ...overrides },
    })
  }

  // Shared across (almost) every test below — see the suite-level comment.
  let owner: Awaited<ReturnType<typeof createConnectedUser>>
  let other: Awaited<ReturnType<typeof createConnectedUser>>
  let collaborator: Awaited<ReturnType<typeof createConnectedUser>>

  beforeAll(async () => {
    owner = await createConnectedUser('owner')
    other = await createConnectedUser('other')
    collaborator = await createConnectedUser('collaborator')
  })

  afterAll(async () => {
    await prisma.albumsOnPhotos.deleteMany({ where: { album: { admin_id: { in: [owner.id, other.id, collaborator.id] } } } })
    await prisma.album.deleteMany({ where: { admin_id: { in: [owner.id, other.id, collaborator.id] } } })
    await prisma.user.deleteMany({ where: { email: { startsWith: emailPrefix } } })
    await fakeS3.close()
  })

  describe('create', () => {
    it('creates an Album owned/admined by the authenticated User', async () => {
      const album = await createAlbum(owner.cookieHeader)

      expect(album.title).toBe('My Album')
      expect(album.cover).toBeNull()

      const row = await prisma.album.findUniqueOrThrow({ where: { id: album.id } })
      expect(row.admin_id).toBe(owner.id)
    })

    it('starts with a photo_count of 0', async () => {
      const album = await createAlbum(owner.cookieHeader)
      expect(album.photo_count).toBe(0)
    })

    it('rejects a missing title', async () => {
      await expect(
        $fetch('/api/albums', {
          method: 'POST',
          headers: { cookie: owner.cookieHeader },
          body: { description: 'no title' },
        }),
      ).rejects.toMatchObject({ statusCode: 400, statusMessage: 'validation.invalid_payload' })
    })

    it('rejects an unauthenticated request with 401', async () => {
      await expect(
        $fetch('/api/albums', { method: 'POST', body: { title: 'x' } }),
      ).rejects.toMatchObject({ statusCode: 401 })
    })
  })

  describe('list', () => {
    it('returns only the authenticated User\'s own Albums, newest first, with a cover', async () => {
      const firstAlbum = await createAlbum(owner.cookieHeader, { title: 'List First' })
      const secondAlbum = await createAlbum(owner.cookieHeader, { title: 'List Second' })
      const othersAlbum = await createAlbum(other.cookieHeader, { title: 'Other user album' })

      const photo = await uploadPhoto(owner.cookieHeader)
      await $fetch(`/api/albums/${secondAlbum.id}/photos/${photo.id}`, {
        method: 'POST',
        headers: { cookie: owner.cookieHeader },
      })

      const response = await $fetch<{ albums: { id: number, cover: string | null, photo_count: number }[], next_cursor: number | null }>('/api/albums', {
        headers: { cookie: owner.cookieHeader },
      })

      const ids = response.albums.map(album => album.id)
      expect(ids).toContain(firstAlbum.id)
      expect(ids).not.toContain(othersAlbum.id)
      expect(response.albums[0]!.id).toBe(secondAlbum.id)
      expect(response.albums[0]!.cover).toBe(`/api/photos/${photo.id}/image`)
      expect(response.albums[0]!.photo_count).toBe(1)
      expect(response.albums.find(album => album.id === firstAlbum.id)!.photo_count).toBe(0)
    })

    it('counts every assigned Photo even when its owner has no Storage Connection', async () => {
      const album = await createAlbum(owner.cookieHeader, { title: 'Count Without Storage' })
      const photo = await uploadPhoto(owner.cookieHeader)
      await $fetch(`/api/albums/${album.id}/photos/${photo.id}`, { method: 'POST', headers: { cookie: owner.cookieHeader } })

      await prisma.storageConnection.delete({ where: { user_id: owner.id } })

      try {
        const response = await $fetch<{ albums: { id: number, photo_count: number }[] }>('/api/albums', {
          headers: { cookie: owner.cookieHeader },
        })

        expect(response.albums.find(a => a.id === album.id)!.photo_count).toBe(1)
      }
      finally {
        // Restore the Storage Connection so afterAll/other tests relying
        // on `owner` still having one aren't affected.
        const restoredBucket = uniqueBucketName('owner-restored')
        fakeS3.seedBucket(restoredBucket)
        await prisma.storageConnection.create({
          data: {
            bucket: restoredBucket,
            region: 'eu-west-3',
            role_arn: testRoleArn,
            external_id: testExternalId,
            user: { connect: { id: owner.id } },
          },
        })
      }
    })

    it('paginates with a keyset cursor', async () => {
      for (let i = 0; i < 3; i++) await createAlbum(owner.cookieHeader, { title: `Pagination Album ${i}` })

      const firstPage = await $fetch<{ albums: { id: number }[], next_cursor: number | null }>('/api/albums?limit=2', {
        headers: { cookie: owner.cookieHeader },
      })

      expect(firstPage.albums).toHaveLength(2)
      expect(firstPage.next_cursor).not.toBeNull()

      const secondPage = await $fetch<{ albums: { id: number }[], next_cursor: number | null }>(`/api/albums?limit=2&cursor=${firstPage.next_cursor}`, {
        headers: { cookie: owner.cookieHeader },
      })

      expect(secondPage.albums).toHaveLength(2)
      expect(secondPage.albums.map(a => a.id)).not.toEqual(firstPage.albums.map(a => a.id))
    })

    it('rejects an unauthenticated request with 401', async () => {
      await expect($fetch('/api/albums')).rejects.toMatchObject({ statusCode: 401 })
    })
  })

  describe('search', () => {
    it('finds an Album by a keyword in its title or description', async () => {
      const target = await createAlbum(owner.cookieHeader, { title: 'Summer Vacation Unique', description: 'Beach days unique' })
      await createAlbum(owner.cookieHeader, { title: 'Winter Unique', description: 'Snow' })

      const byTitle = await $fetch<{ albums: { id: number }[] }>('/api/albums/search?q=vacation unique', {
        headers: { cookie: owner.cookieHeader },
      })
      expect(byTitle.albums.map(album => album.id)).toContain(target.id)

      const byDescription = await $fetch<{ albums: { id: number }[] }>('/api/albums/search?q=beach days unique', {
        headers: { cookie: owner.cookieHeader },
      })
      expect(byDescription.albums.map(album => album.id)).toContain(target.id)
    })

    it('never returns another User\'s Album', async () => {
      const theirs = await createAlbum(owner.cookieHeader, { title: 'Cross Account Keyword' })

      const response = await $fetch<{ albums: { id: number }[] }>('/api/albums/search?q=cross account keyword', {
        headers: { cookie: other.cookieHeader },
      })
      expect(response.albums.map(album => album.id)).not.toContain(theirs.id)
    })

    it('rejects a missing keyword', async () => {
      await expect(
        $fetch('/api/albums/search', { headers: { cookie: owner.cookieHeader } }),
      ).rejects.toMatchObject({ statusCode: 400, statusMessage: 'albums.invalid_query' })
    })

    it('rejects an unauthenticated request with 401', async () => {
      await expect($fetch('/api/albums/search?q=x')).rejects.toMatchObject({ statusCode: 401 })
    })
  })

  describe('full show', () => {
    it('returns the Album with its admin, Collaborators, and photo_count, but no Photos (issue #170)', async () => {
      const album = await createAlbum(owner.cookieHeader)
      const photo = await uploadPhoto(owner.cookieHeader)
      await $fetch(`/api/albums/${album.id}/photos/${photo.id}`, { method: 'POST', headers: { cookie: owner.cookieHeader } })

      const full = await $fetch<{ id: number, collaborators: unknown[], admin: { id: number }, photo_count: number }>(`/api/albums/${album.id}`, {
        headers: { cookie: owner.cookieHeader },
      })

      expect(full.collaborators).toEqual([])
      expect(full.admin.id).toBe(owner.id)
      expect(full.photo_count).toBe(1)
      expect(full).not.toHaveProperty('photos')
    })

    it('rejects a non-member with 404', async () => {
      const album = await createAlbum(owner.cookieHeader)

      await expect(
        $fetch(`/api/albums/${album.id}`, { headers: { cookie: other.cookieHeader } }),
      ).rejects.toMatchObject({ statusCode: 404, statusMessage: 'albums.not_found' })
    })

    it('rejects an unauthenticated request with 401', async () => {
      await expect($fetch('/api/albums/1')).rejects.toMatchObject({ statusCode: 401 })
    })
  })

  describe('lightweight show', () => {
    it('returns only the cover and admin', async () => {
      const album = await createAlbum(owner.cookieHeader, { title: 'Light Show Album' })

      const light = await $fetch<{ id: number, cover: string | null, admin: { id: number } }>(`/api/albums/${album.id}/light`, {
        headers: { cookie: owner.cookieHeader },
      })

      expect(light.id).toBe(album.id)
      expect(light.admin.id).toBe(owner.id)
      expect(light).not.toHaveProperty('title')
      expect(light).not.toHaveProperty('description')
      expect(light).not.toHaveProperty('photos')
      expect(light).not.toHaveProperty('collaborators')
    })

    it('rejects a non-member with 404', async () => {
      const album = await createAlbum(owner.cookieHeader)

      await expect(
        $fetch(`/api/albums/${album.id}/light`, { headers: { cookie: other.cookieHeader } }),
      ).rejects.toMatchObject({ statusCode: 404, statusMessage: 'albums.not_found' })
    })
  })

  describe('update', () => {
    it('renames the title and edits the description', async () => {
      const album = await createAlbum(owner.cookieHeader)

      const updated = await $fetch<{ title: string, description: string }>(`/api/albums/${album.id}`, {
        method: 'PATCH',
        headers: { cookie: owner.cookieHeader },
        body: { title: 'Renamed', description: 'New description' },
      })

      expect(updated.title).toBe('Renamed')
      expect(updated.description).toBe('New description')
    })

    it('rejects a non-member with 404', async () => {
      const album = await createAlbum(owner.cookieHeader)

      await expect(
        $fetch(`/api/albums/${album.id}`, { method: 'PATCH', headers: { cookie: other.cookieHeader }, body: { title: 'x' } }),
      ).rejects.toMatchObject({ statusCode: 404, statusMessage: 'albums.not_found' })
    })

    it('rejects an unauthenticated request with 401', async () => {
      await expect(
        $fetch('/api/albums/1', { method: 'PATCH', body: { title: 'x' } }),
      ).rejects.toMatchObject({ statusCode: 401 })
    })
  })

  describe('delete', () => {
    it('removes the Album for its admin', async () => {
      const album = await createAlbum(owner.cookieHeader)

      const response = await fetch(`/api/albums/${album.id}`, { method: 'DELETE', headers: { cookie: owner.cookieHeader } })
      expect(response.status).toBe(204)

      await expect(prisma.album.findUnique({ where: { id: album.id } })).resolves.toBeNull()
    })

    it('rejects a non-admin member with 403', async () => {
      const album = await createAlbum(owner.cookieHeader)

      // No collaborator-invite endpoint exists yet (issue #52) — connect
      // the collaborator directly via Prisma to exercise the admin-only
      // delete guard against a real non-admin member.
      await prisma.album.update({ where: { id: album.id }, data: { users: { connect: { id: collaborator.id } } } })

      await expect(
        $fetch(`/api/albums/${album.id}`, { method: 'DELETE', headers: { cookie: collaborator.cookieHeader } }),
      ).rejects.toMatchObject({ statusCode: 403, statusMessage: 'albums.admin_only' })

      await expect(prisma.album.findUnique({ where: { id: album.id } })).resolves.not.toBeNull()
    })

    it('rejects a non-member with 404', async () => {
      const album = await createAlbum(owner.cookieHeader)

      await expect(
        $fetch(`/api/albums/${album.id}`, { method: 'DELETE', headers: { cookie: other.cookieHeader } }),
      ).rejects.toMatchObject({ statusCode: 404, statusMessage: 'albums.not_found' })
    })

    it('rejects an unauthenticated request with 401', async () => {
      await expect(
        $fetch('/api/albums/1', { method: 'DELETE' }),
      ).rejects.toMatchObject({ statusCode: 401 })
    })
  })

  describe('add / remove photo', () => {
    it('adds then removes a Photo from an Album, returning just the affected Photo (add) / no body (remove) — issue #170', async () => {
      const album = await createAlbum(owner.cookieHeader)
      const photo = await uploadPhoto(owner.cookieHeader)

      const afterAdd = await $fetch<{ id: number, url: string }>(`/api/albums/${album.id}/photos/${photo.id}`, {
        method: 'POST',
        headers: { cookie: owner.cookieHeader },
      })
      expect(afterAdd.id).toBe(photo.id)

      const idsAfterAdd = await prisma.albumsOnPhotos.findMany({ where: { album_id: album.id } })
      expect(idsAfterAdd.map(row => row.photo_id)).toEqual([photo.id])

      const removeResponse = await fetch(`/api/albums/${album.id}/photos/${photo.id}`, {
        method: 'DELETE',
        headers: { cookie: owner.cookieHeader },
      })
      expect(removeResponse.status).toBe(204)

      const idsAfterRemove = await prisma.albumsOnPhotos.findMany({ where: { album_id: album.id } })
      expect(idsAfterRemove).toHaveLength(0)
    })

    it('is idempotent when adding the same Photo twice', async () => {
      const album = await createAlbum(owner.cookieHeader)
      const photo = await uploadPhoto(owner.cookieHeader)

      await $fetch(`/api/albums/${album.id}/photos/${photo.id}`, { method: 'POST', headers: { cookie: owner.cookieHeader } })
      await $fetch(`/api/albums/${album.id}/photos/${photo.id}`, { method: 'POST', headers: { cookie: owner.cookieHeader } })

      const rows = await prisma.albumsOnPhotos.findMany({ where: { album_id: album.id } })
      expect(rows).toHaveLength(1)
    })

    it('rejects adding another User\'s Photo with 404', async () => {
      const album = await createAlbum(owner.cookieHeader)
      const othersPhoto = await uploadPhoto(other.cookieHeader)

      await expect(
        $fetch(`/api/albums/${album.id}/photos/${othersPhoto.id}`, { method: 'POST', headers: { cookie: owner.cookieHeader } }),
      ).rejects.toMatchObject({ statusCode: 404, statusMessage: 'albums.photo_not_found' })
    })

    it('rejects a non-member with 404', async () => {
      const album = await createAlbum(owner.cookieHeader)
      const photo = await uploadPhoto(owner.cookieHeader)

      await expect(
        $fetch(`/api/albums/${album.id}/photos/${photo.id}`, { method: 'POST', headers: { cookie: other.cookieHeader } }),
      ).rejects.toMatchObject({ statusCode: 404, statusMessage: 'albums.not_found' })
    })

    it('rejects an unauthenticated request with 401', async () => {
      await expect(
        $fetch('/api/albums/1/photos/1', { method: 'POST' }),
      ).rejects.toMatchObject({ statusCode: 401 })
    })
  })

  describe('paginated photos (issue #170)', () => {
    it('lists an Album\'s Photos newest-assigned-first, paginated with a keyset cursor', async () => {
      const album = await createAlbum(owner.cookieHeader, { title: 'Paginated Photos Album' })
      const photos = []
      for (let i = 0; i < 3; i++) {
        const photo = await uploadPhoto(owner.cookieHeader)
        await $fetch(`/api/albums/${album.id}/photos/${photo.id}`, { method: 'POST', headers: { cookie: owner.cookieHeader } })
        photos.push(photo)
      }

      const firstPage = await $fetch<{ photos: { id: number }[], next_cursor: number | null }>(`/api/albums/${album.id}/photos?limit=2`, {
        headers: { cookie: owner.cookieHeader },
      })

      expect(firstPage.photos).toHaveLength(2)
      expect(firstPage.photos.map(p => p.id)).toEqual([photos[2]!.id, photos[1]!.id])
      expect(firstPage.next_cursor).not.toBeNull()

      const secondPage = await $fetch<{ photos: { id: number }[], next_cursor: number | null }>(`/api/albums/${album.id}/photos?limit=2&cursor=${firstPage.next_cursor}`, {
        headers: { cookie: owner.cookieHeader },
      })

      expect(secondPage.photos).toHaveLength(1)
      expect(secondPage.photos[0]!.id).toBe(photos[0]!.id)
      expect(secondPage.next_cursor).toBeNull()
    })

    it('rejects a cursor that isn\'t assigned to this Album', async () => {
      const album = await createAlbum(owner.cookieHeader, { title: 'Invalid Cursor Album' })
      const photo = await uploadPhoto(owner.cookieHeader)

      await expect(
        $fetch(`/api/albums/${album.id}/photos?cursor=${photo.id}`, { headers: { cookie: owner.cookieHeader } }),
      ).rejects.toMatchObject({ statusCode: 400, statusMessage: 'albums.invalid_cursor' })
    })

    it('rejects a non-member with 404', async () => {
      const album = await createAlbum(owner.cookieHeader)

      await expect(
        $fetch(`/api/albums/${album.id}/photos`, { headers: { cookie: other.cookieHeader } }),
      ).rejects.toMatchObject({ statusCode: 404, statusMessage: 'albums.not_found' })
    })

    it('rejects an unauthenticated request with 401', async () => {
      await expect($fetch('/api/albums/1/photos')).rejects.toMatchObject({ statusCode: 401 })
    })
  })

  describe('photo ids (issue #170)', () => {
    it('returns every Photo id assigned to the Album, for membership checks', async () => {
      const album = await createAlbum(owner.cookieHeader, { title: 'Photo Ids Album' })
      const photo = await uploadPhoto(owner.cookieHeader)
      await $fetch(`/api/albums/${album.id}/photos/${photo.id}`, { method: 'POST', headers: { cookie: owner.cookieHeader } })

      const response = await $fetch<{ photo_ids: number[] }>(`/api/albums/${album.id}/photo-ids`, {
        headers: { cookie: owner.cookieHeader },
      })

      expect(response.photo_ids).toEqual([photo.id])
    })

    it('rejects a non-member with 404', async () => {
      const album = await createAlbum(owner.cookieHeader)

      await expect(
        $fetch(`/api/albums/${album.id}/photo-ids`, { headers: { cookie: other.cookieHeader } }),
      ).rejects.toMatchObject({ statusCode: 404, statusMessage: 'albums.not_found' })
    })

    it('rejects an unauthenticated request with 401', async () => {
      await expect($fetch('/api/albums/1/photo-ids')).rejects.toMatchObject({ statusCode: 401 })
    })
  })
})
