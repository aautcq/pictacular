import type { FakeS3Server } from './fake-s3-server'
import process from 'node:process'
import { $fetch, fetch, setup } from '@nuxt/test-utils/e2e'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '../../server/utils/prisma'
import { startFakeS3Server } from './fake-s3-server'

// Black-box HTTP tests for Album Public Share Links (issue #53): the
// admin-only generate/rotate endpoint, the public token-lookup endpoint
// (unauthenticated, read-only Photos, no Collaborators), and confirmation
// that a valid share token never grants access to like/edit/collaborate
// endpoints — those still require a real session regardless of what
// token is presented alongside them. Mirrors albums.test.ts's fixture
// setup (a fake S3 double + a small fixed set of connected Users shared
// across tests) since Photos need a Storage Connection.
describe('album public share links', async () => {
  const fakeS3: FakeS3Server = await startFakeS3Server()
  process.env.AWS_S3_ENDPOINT = fakeS3.url

  await setup()

  const emailPrefix = `share-link-${Date.now()}`
  const password = 'Str0ng!Pass'
  const tinyPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

  function uniqueEmail(label: string) {
    return `${emailPrefix}-${label}@example.com`
  }

  function uniqueBucketName(label: string) {
    return `share-link-bucket-${label}-${Math.random().toString(36).slice(2)}`
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

    await $fetch('/api/storage-connections', {
      method: 'POST',
      headers: { cookie: cookieHeader },
      body: { mode: 'connect', access_key_id: 'AKIATEST', secret_access_key: 'test-secret', bucket },
    })

    return { ...user, cookieHeader }
  }

  async function createAlbum(cookieHeader: string, overrides: Record<string, unknown> = {}) {
    return $fetch<{ id: number, title: string }>('/api/albums', {
      method: 'POST',
      headers: { cookie: cookieHeader },
      body: { title: 'Shared Album', description: 'A description', ...overrides },
    })
  }

  async function uploadPhoto(cookieHeader: string, overrides: Record<string, unknown> = {}) {
    return $fetch<{ id: number, url: string }>('/api/photos', {
      method: 'POST',
      headers: { cookie: cookieHeader },
      body: { filename: 'photo.png', mime_type: 'image/png', base64: tinyPngBase64, ...overrides },
    })
  }

  let owner: Awaited<ReturnType<typeof createConnectedUser>>
  let collaborator: Awaited<ReturnType<typeof createConnectedUser>>
  let other: Awaited<ReturnType<typeof createConnectedUser>>

  beforeAll(async () => {
    owner = await createConnectedUser('owner')
    collaborator = await createConnectedUser('collaborator')
    other = await createConnectedUser('other')
  })

  afterAll(async () => {
    await prisma.albumsOnPhotos.deleteMany({ where: { album: { admin_id: { in: [owner.id, collaborator.id, other.id] } } } })
    await prisma.album.deleteMany({ where: { admin_id: { in: [owner.id, collaborator.id, other.id] } } })
    await prisma.user.deleteMany({ where: { email: { startsWith: emailPrefix } } })
    await fakeS3.close()
  })

  describe('generate / rotate', () => {
    it('generates a share token for the admin', async () => {
      const album = await createAlbum(owner.cookieHeader)

      const response = await $fetch<{ share_token: string }>(`/api/albums/${album.id}/share-link`, {
        method: 'POST',
        headers: { cookie: owner.cookieHeader },
      })

      expect(response.share_token).toEqual(expect.any(String))

      const row = await prisma.album.findUniqueOrThrow({ where: { id: album.id } })
      expect(row.share_token).toBe(response.share_token)
    })

    it('rotates to a fresh token, invalidating the previous one', async () => {
      const album = await createAlbum(owner.cookieHeader)

      const first = await $fetch<{ share_token: string }>(`/api/albums/${album.id}/share-link`, {
        method: 'POST',
        headers: { cookie: owner.cookieHeader },
      })
      const second = await $fetch<{ share_token: string }>(`/api/albums/${album.id}/share-link`, {
        method: 'POST',
        headers: { cookie: owner.cookieHeader },
      })

      expect(second.share_token).not.toBe(first.share_token)

      await expect($fetch(`/api/albums/public/${first.share_token}`)).rejects.toMatchObject({ statusCode: 404 })
      await expect($fetch(`/api/albums/public/${second.share_token}`)).resolves.toMatchObject({ id: album.id })
    })

    it('rejects a non-admin Collaborator with 403', async () => {
      const album = await createAlbum(owner.cookieHeader)
      await prisma.album.update({ where: { id: album.id }, data: { users: { connect: { id: collaborator.id } } } })

      await expect(
        $fetch(`/api/albums/${album.id}/share-link`, { method: 'POST', headers: { cookie: collaborator.cookieHeader } }),
      ).rejects.toMatchObject({ statusCode: 403, statusMessage: 'albums.admin_only' })
    })

    it('rejects a non-member with 404', async () => {
      const album = await createAlbum(owner.cookieHeader)

      await expect(
        $fetch(`/api/albums/${album.id}/share-link`, { method: 'POST', headers: { cookie: other.cookieHeader } }),
      ).rejects.toMatchObject({ statusCode: 404, statusMessage: 'albums.not_found' })
    })

    it('rejects an unauthenticated request with 401', async () => {
      await expect(
        $fetch('/api/albums/1/share-link', { method: 'POST' }),
      ).rejects.toMatchObject({ statusCode: 401 })
    })
  })

  describe('full show', () => {
    it('only includes share_token for the admin, not a Collaborator', async () => {
      const album = await createAlbum(owner.cookieHeader)
      await prisma.album.update({ where: { id: album.id }, data: { users: { connect: { id: collaborator.id } } } })
      const { share_token } = await $fetch<{ share_token: string }>(`/api/albums/${album.id}/share-link`, {
        method: 'POST',
        headers: { cookie: owner.cookieHeader },
      })

      const asAdmin = await $fetch<{ share_token: string | null }>(`/api/albums/${album.id}`, { headers: { cookie: owner.cookieHeader } })
      expect(asAdmin.share_token).toBe(share_token)

      const asCollaborator = await $fetch<{ share_token: string | null }>(`/api/albums/${album.id}`, { headers: { cookie: collaborator.cookieHeader } })
      expect(asCollaborator.share_token).toBeNull()
    })
  })

  describe('public token lookup', () => {
    it('returns the Album\'s title, cover, and photo_count unauthenticated, without Collaborators or Photos (issue #170)', async () => {
      const album = await createAlbum(owner.cookieHeader, { title: 'Public Album' })
      const photo = await uploadPhoto(owner.cookieHeader)
      await $fetch(`/api/albums/${album.id}/photos/${photo.id}`, { method: 'POST', headers: { cookie: owner.cookieHeader } })
      const { share_token } = await $fetch<{ share_token: string }>(`/api/albums/${album.id}/share-link`, {
        method: 'POST',
        headers: { cookie: owner.cookieHeader },
      })

      const publicAlbum = await $fetch<{
        id: number
        title: string
        admin: { id: number }
        photo_count: number
        photos?: unknown
        collaborators?: unknown
      }>(`/api/albums/public/${share_token}`)

      expect(publicAlbum.id).toBe(album.id)
      expect(publicAlbum.title).toBe('Public Album')
      expect(publicAlbum.admin.id).toBe(owner.id)
      expect(publicAlbum.photo_count).toBe(1)
      expect(publicAlbum).not.toHaveProperty('photos')
      expect(publicAlbum).not.toHaveProperty('collaborators')
    })

    it('rejects an unknown token with 404', async () => {
      await expect($fetch('/api/albums/public/does-not-exist')).rejects.toMatchObject({ statusCode: 404, statusMessage: 'albums.not_found' })
    })

    it('needs no authentication at all — no cookie header is sent', async () => {
      const album = await createAlbum(owner.cookieHeader)
      const { share_token } = await $fetch<{ share_token: string }>(`/api/albums/${album.id}/share-link`, {
        method: 'POST',
        headers: { cookie: owner.cookieHeader },
      })

      const response = await fetch(`/api/albums/public/${share_token}`)
      expect(response.status).toBe(200)
    })
  })

  describe('public paginated photos (issue #170)', () => {
    it('lists the shared Album\'s Photos unauthenticated, without like info, paginated with a keyset cursor', async () => {
      const album = await createAlbum(owner.cookieHeader, { title: 'Public Paginated Photos Album' })
      const photos = []
      for (let i = 0; i < 3; i++) {
        const photo = await uploadPhoto(owner.cookieHeader)
        await $fetch(`/api/albums/${album.id}/photos/${photo.id}`, { method: 'POST', headers: { cookie: owner.cookieHeader } })
        photos.push(photo)
      }
      const { share_token } = await $fetch<{ share_token: string }>(`/api/albums/${album.id}/share-link`, {
        method: 'POST',
        headers: { cookie: owner.cookieHeader },
      })

      const firstPage = await $fetch<{ photos: { id: number, url: string, liked?: unknown }[], next_cursor: number | null }>(`/api/albums/public/${share_token}/photos?limit=2`)

      expect(firstPage.photos).toHaveLength(2)
      expect(firstPage.photos.map(p => p.id)).toEqual([photos[2]!.id, photos[1]!.id])
      expect(firstPage.photos[0]).not.toHaveProperty('liked')
      expect(firstPage.next_cursor).not.toBeNull()

      const secondPage = await $fetch<{ photos: { id: number }[], next_cursor: number | null }>(`/api/albums/public/${share_token}/photos?limit=2&cursor=${firstPage.next_cursor}`)

      expect(secondPage.photos).toHaveLength(1)
      expect(secondPage.photos[0]!.id).toBe(photos[0]!.id)
      expect(secondPage.next_cursor).toBeNull()
    })

    it('rejects an unknown token with 404', async () => {
      await expect($fetch('/api/albums/public/does-not-exist/photos')).rejects.toMatchObject({ statusCode: 404, statusMessage: 'albums.not_found' })
    })
  })

  describe('public image (issue #168)', () => {
    it('streams a Photo\'s bytes for a valid token, no session needed', async () => {
      const album = await createAlbum(owner.cookieHeader, { title: 'Public Image Album' })
      const photo = await uploadPhoto(owner.cookieHeader)
      await $fetch(`/api/albums/${album.id}/photos/${photo.id}`, { method: 'POST', headers: { cookie: owner.cookieHeader } })
      const { share_token } = await $fetch<{ share_token: string }>(`/api/albums/${album.id}/share-link`, {
        method: 'POST',
        headers: { cookie: owner.cookieHeader },
      })

      const response = await fetch(`/api/albums/public/${share_token}/photos/${photo.id}/image`)

      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe('image/png')
    })

    it('rejects an unknown token with 404', async () => {
      const album = await createAlbum(owner.cookieHeader)
      const photo = await uploadPhoto(owner.cookieHeader)
      await $fetch(`/api/albums/${album.id}/photos/${photo.id}`, { method: 'POST', headers: { cookie: owner.cookieHeader } })

      await expect(
        $fetch(`/api/albums/public/does-not-exist/photos/${photo.id}/image`),
      ).rejects.toMatchObject({ statusCode: 404, statusMessage: 'albums.not_found' })
    })

    it('rejects a Photo not assigned to that token\'s Album with 404', async () => {
      const album = await createAlbum(owner.cookieHeader, { title: 'Empty Public Album' })
      const otherPhoto = await uploadPhoto(owner.cookieHeader)
      const { share_token } = await $fetch<{ share_token: string }>(`/api/albums/${album.id}/share-link`, {
        method: 'POST',
        headers: { cookie: owner.cookieHeader },
      })

      await expect(
        $fetch(`/api/albums/public/${share_token}/photos/${otherPhoto.id}/image`),
      ).rejects.toMatchObject({ statusCode: 404, statusMessage: 'albums.not_found' })
    })
  })

  describe('like/edit endpoints reject a share token', () => {
    it('rejects liking a Photo with only a share token, no session', async () => {
      const album = await createAlbum(owner.cookieHeader)
      const photo = await uploadPhoto(owner.cookieHeader)
      await $fetch(`/api/albums/${album.id}/photos/${photo.id}`, { method: 'POST', headers: { cookie: owner.cookieHeader } })
      const { share_token } = await $fetch<{ share_token: string }>(`/api/albums/${album.id}/share-link`, {
        method: 'POST',
        headers: { cookie: owner.cookieHeader },
      })

      await expect(
        $fetch(`/api/photos/${photo.id}/like`, {
          method: 'POST',
          headers: { 'x-share-token': share_token },
        }),
      ).rejects.toMatchObject({ statusCode: 401 })
    })

    it('rejects editing the Album with only a share token, no session', async () => {
      const album = await createAlbum(owner.cookieHeader)
      const { share_token } = await $fetch<{ share_token: string }>(`/api/albums/${album.id}/share-link`, {
        method: 'POST',
        headers: { cookie: owner.cookieHeader },
      })

      await expect(
        $fetch(`/api/albums/${album.id}`, {
          method: 'PATCH',
          headers: { 'x-share-token': share_token },
          body: { title: 'Hijacked' },
        }),
      ).rejects.toMatchObject({ statusCode: 401 })
    })
  })
})
