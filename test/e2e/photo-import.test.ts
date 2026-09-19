import type { FakeS3Server, SeedObject } from './fake-s3-server'
import { Buffer } from 'node:buffer'
import process from 'node:process'
import { $fetch, fetch, setup, url } from '@nuxt/test-utils/e2e'
import { afterAll, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { prisma } from '../../server/utils/prisma'
import { EXIF_RANGE_BYTES } from '../../server/utils/storage'
import { buildJpegWithDateTimeOriginal } from './exif-fixtures'
import { startFakeS3Server, testExternalId, testRoleArn } from './fake-s3-server'

// Black-box HTTP tests for importing a User's pre-existing bucket
// contents (issue #54): walks every page of the connected bucket, derives
// Album titles from folder prefixes (creating Albums as needed), creates
// Photo rows for each image found, links them into their derived Albums,
// and reports progress over the existing WS infra. Real AWS is replaced
// by an in-process fake S3 double (see fake-s3-server.ts) — no mocking of
// this app's own server/utils modules.
describe('import bucket photos', async () => {
  const fakeS3: FakeS3Server = await startFakeS3Server()
  process.env.AWS_S3_ENDPOINT = fakeS3.url

  await setup()

  const emailPrefix = `photo-import-${Date.now()}`
  const password = 'Str0ng!Pass'

  function uniqueEmail() {
    return `${emailPrefix}-${Math.random().toString(36).slice(2)}@example.com`
  }

  function uniqueBucketName() {
    return `import-bucket-${Math.random().toString(36).slice(2)}`
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

  async function createConnectedUser(keys: (string | SeedObject)[] = []) {
    const user = await createVerifiedUser()
    const cookieHeader = await loginCookieHeader(user.email)
    const bucket = uniqueBucketName()
    fakeS3.seedBucket(bucket, keys)

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

  function openSocket(cookieHeader: string) {
    return new WebSocket(url('/ws').replace(/^http/, 'ws'), { headers: { cookie: cookieHeader } })
  }

  function waitForOpen(socket: WebSocket) {
    return new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve())
      socket.once('error', reject)
    })
  }

  function collectMessages(socket: WebSocket) {
    const messages: any[] = []
    socket.on('message', (data) => {
      messages.push(JSON.parse(data.toString()))
    })
    return messages
  }

  afterAll(async () => {
    const users = await prisma.user.findMany({ where: { email: { startsWith: emailPrefix } } })
    const userIds = users.map(user => user.id)
    await prisma.albumsOnPhotos.deleteMany({ where: { album: { admin_id: { in: userIds } } } })
    await prisma.album.deleteMany({ where: { admin_id: { in: userIds } } })
    await prisma.user.deleteMany({ where: { email: { startsWith: emailPrefix } } })
    await fakeS3.close()
  })

  it('creates Albums from folder prefixes, Photos, and links them, reporting progress over WS', async () => {
    const { id: userId, cookieHeader } = await createConnectedUser([
      'holiday/beach.jpg',
      'holiday/sunset.png',
      'root.png',
      'notes.txt',
    ])

    const socket = openSocket(cookieHeader)
    await waitForOpen(socket)
    const messages = collectMessages(socket)

    const response = await $fetch<{ imported: number, albums: number, done: boolean }>('/api/photos/import', {
      method: 'POST',
      headers: { cookie: cookieHeader },
    })

    expect(response).toEqual({ imported: 3, albums: 1, done: true })

    const photos = await prisma.photo.findMany({ where: { user_id: userId } })
    expect(photos).toHaveLength(3)
    expect(photos.some(photo => photo.key === 'notes.txt')).toBe(false)

    const album = await prisma.album.findFirstOrThrow({ where: { admin_id: userId, title: 'holiday' } })
    const links = await prisma.albumsOnPhotos.findMany({ where: { album_id: album.id } })
    expect(links).toHaveLength(2)

    const rootPhoto = photos.find(photo => photo.key === 'root.png')!
    const rootLinks = await prisma.albumsOnPhotos.findMany({ where: { photo_id: rootPhoto.id } })
    expect(rootLinks).toHaveLength(0)

    // Give the WS messages sent during the (already-awaited) import a tick
    // to be delivered to this test's own socket before asserting on them.
    await new Promise(resolve => setTimeout(resolve, 100))

    const progressMessages = messages.filter(message => message.name === 'import:progress')
    expect(progressMessages).toHaveLength(3)
    expect(progressMessages.at(-1)?.data).toMatchObject({ imported: 3, total: 3 })

    const completedMessage = messages.find(message => message.name === 'import:completed')
    expect(completedMessage?.data).toEqual({ imported: 3, albums: 1 })

    socket.close()
  })

  it('reuses an existing Album with the same title rather than creating a duplicate', async () => {
    const { id: userId, cookieHeader } = await createConnectedUser(['holiday/beach.jpg'])

    await $fetch('/api/albums', {
      method: 'POST',
      headers: { cookie: cookieHeader },
      body: { title: 'holiday' },
    })

    const response = await $fetch<{ imported: number, albums: number, done: boolean }>('/api/photos/import', {
      method: 'POST',
      headers: { cookie: cookieHeader },
    })

    expect(response).toEqual({ imported: 1, albums: 1, done: true })

    const albums = await prisma.album.findMany({ where: { admin_id: userId, title: 'holiday' } })
    expect(albums).toHaveLength(1)
  })

  it('re-running the import does not duplicate Photo rows for objects already imported', async () => {
    const { id: userId, cookieHeader } = await createConnectedUser(['holiday/beach.jpg', 'root.png'])

    await $fetch('/api/photos/import', { method: 'POST', headers: { cookie: cookieHeader } })
    const response = await $fetch<{ imported: number, albums: number, done: boolean }>('/api/photos/import', {
      method: 'POST',
      headers: { cookie: cookieHeader },
    })

    expect(response).toEqual({ imported: 2, albums: 1, done: true })

    const photos = await prisma.photo.findMany({ where: { user_id: userId } })
    expect(photos).toHaveLength(2)

    const album = await prisma.album.findFirstOrThrow({ where: { admin_id: userId, title: 'holiday' } })
    const links = await prisma.albumsOnPhotos.findMany({ where: { album_id: album.id } })
    expect(links).toHaveLength(1)
  })

  // issue #162: an imported Photo's Taken At date, derived from its own
  // EXIF metadata rather than defaulting to import time.
  describe('taken At (issue #162)', () => {
    it('extracts taken_at from a JPEG\'s EXIF via a single ranged read', async () => {
      const takenAt = new Date('2020-01-15T10:30:00.000Z')
      const jpeg = buildJpegWithDateTimeOriginal(takenAt)
      const { id: userId, cookieHeader } = await createConnectedUser([{ key: 'holiday/ranged-read.jpg', body: jpeg, contentType: 'image/jpeg' }])

      await $fetch('/api/photos/import', { method: 'POST', headers: { cookie: cookieHeader } })

      const photo = await prisma.photo.findFirstOrThrow({ where: { user_id: userId, key: 'holiday/ranged-read.jpg' } })
      expect(photo.taken_at).toEqual(takenAt)

      const requests = fakeS3.getRequestsFor('holiday/ranged-read.jpg')
      expect(requests).toHaveLength(1)
      expect(requests[0]!.range).toBe(`bytes=0-${EXIF_RANGE_BYTES - 1}`)
    })

    it('escalates to a full-object read when the ranged read misses EXIF placed past its byte window', async () => {
      const takenAt = new Date('2019-06-01T08:00:00.000Z')
      const jpeg = buildJpegWithDateTimeOriginal(takenAt, EXIF_RANGE_BYTES + 10_000)
      const { id: userId, cookieHeader } = await createConnectedUser([{ key: 'holiday/escalated-read.jpg', body: jpeg, contentType: 'image/jpeg' }])

      await $fetch('/api/photos/import', { method: 'POST', headers: { cookie: cookieHeader } })

      const photo = await prisma.photo.findFirstOrThrow({ where: { user_id: userId, key: 'holiday/escalated-read.jpg' } })
      expect(photo.taken_at).toEqual(takenAt)

      const requests = fakeS3.getRequestsFor('holiday/escalated-read.jpg')
      expect(requests).toHaveLength(2)
      expect(requests[0]!.range).toBe(`bytes=0-${EXIF_RANGE_BYTES - 1}`)
      expect(requests[1]!.range).toBeUndefined()
    })

    it('leaves taken_at null, without escalating, for a GIF (no EXIF container exists at any byte range)', async () => {
      const { id: userId, cookieHeader } = await createConnectedUser([{ key: 'holiday/clip.gif', body: Buffer.from('GIF89a-fake-body'), contentType: 'image/gif' }])

      await $fetch('/api/photos/import', { method: 'POST', headers: { cookie: cookieHeader } })

      const photo = await prisma.photo.findFirstOrThrow({ where: { user_id: userId, key: 'holiday/clip.gif' } })
      expect(photo.taken_at).toBeNull()

      const requests = fakeS3.getRequestsFor('holiday/clip.gif')
      expect(requests).toHaveLength(1)
    })

    it('leaves taken_at null for a supported image with no EXIF metadata', async () => {
      const { id: userId, cookieHeader } = await createConnectedUser([{ key: 'holiday/plain.png', body: Buffer.from('fake-png-body'), contentType: 'image/png' }])

      await $fetch('/api/photos/import', { method: 'POST', headers: { cookie: cookieHeader } })

      const photo = await prisma.photo.findFirstOrThrow({ where: { user_id: userId, key: 'holiday/plain.png' } })
      expect(photo.taken_at).toBeNull()
    })
  })

  // Guards against the exact regression this chunking was built to fix
  // (see server/api/photos/import.post.ts's own doc comment): a "many many
  // photos" bucket must never depend on a single request surviving the
  // whole import, so progress is persisted (`import_cursor`/`import_total`/
  // `import_imported`/`import_album_ids`) after every page and a later
  // request resumes from exactly that point instead of re-walking (and
  // re-importing) objects an earlier, interrupted request already handled.
  describe('resumable import (chunked pages)', () => {
    it('resumes from a persisted cursor rather than re-walking objects an earlier request already processed', async () => {
      const { id: userId, cookieHeader } = await createConnectedUser([
        'one.jpg',
        'two.jpg',
        'three.jpg',
      ])

      // Simulates a prior request having already walked the fake S3
      // double's first page (just `one.jpg`, whose extension-matching
      // ListObjectsV2 index is `1` in this fixture's insertion order —
      // see fake-s3-server.ts's index-based continuation token) before
      // getting interrupted (a dropped connection, a proxy timeout, ...)
      // partway through the import — exactly the scenario this chunking
      // exists to survive.
      await prisma.storageConnection.updateMany({
        where: { user_id: userId },
        data: { import_cursor: '1', import_total: 3, import_imported: 1, import_album_ids: [] },
      })

      const response = await $fetch<{ imported: number, albums: number, done: boolean }>('/api/photos/import', {
        method: 'POST',
        headers: { cookie: cookieHeader },
      })

      // The resumed request finishes the remaining two objects on top of
      // the one already-persisted `import_imported` count, without ever
      // re-processing `one.jpg`.
      expect(response).toEqual({ imported: 3, albums: 0, done: true })

      const photos = await prisma.photo.findMany({ where: { user_id: userId } })
      expect(photos.map(photo => photo.key).sort()).toEqual(['three.jpg', 'two.jpg'])

      // Completion resets the persisted cursor/counters, so a later,
      // separate import starts clean rather than inheriting this one's.
      const accountAfterCompletion = await prisma.storageConnection.findFirstOrThrow({ where: { user_id: userId } })
      expect(accountAfterCompletion.import_cursor).toBeNull()
      expect(accountAfterCompletion.import_total).toBeNull()
      expect(accountAfterCompletion.import_imported).toBe(0)
      expect(accountAfterCompletion.import_album_ids).toEqual([])
    })
  })

  it('imports nothing from an empty bucket', async () => {
    const { cookieHeader } = await createConnectedUser()

    const response = await $fetch<{ imported: number, albums: number, done: boolean }>('/api/photos/import', {
      method: 'POST',
      headers: { cookie: cookieHeader },
    })

    expect(response).toEqual({ imported: 0, albums: 0, done: true })
  })

  it('rejects a User without a Storage Connection', async () => {
    const user = await createVerifiedUser()
    const cookieHeader = await loginCookieHeader(user.email)

    await expect(
      $fetch('/api/photos/import', { method: 'POST', headers: { cookie: cookieHeader } }),
    ).rejects.toMatchObject({ statusCode: 400, statusMessage: 'photos.storage_connection_required' })
  })

  it('rejects an unauthenticated request with 401', async () => {
    await expect(
      $fetch('/api/photos/import', { method: 'POST' }),
    ).rejects.toMatchObject({ statusCode: 401 })
  })
})
