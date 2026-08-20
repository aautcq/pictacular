import type { FakeS3Server } from './fake-s3-server'
import process from 'node:process'
import { $fetch, fetch, setup, url } from '@nuxt/test-utils/e2e'
import { afterAll, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { prisma } from '../../server/utils/prisma'
import { startFakeS3Server } from './fake-s3-server'

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

  async function createConnectedUser(keys: string[] = []) {
    const user = await createVerifiedUser()
    const cookieHeader = await loginCookieHeader(user.email)
    const bucket = uniqueBucketName()
    fakeS3.seedBucket(bucket, keys)

    await $fetch('/api/storage-connections', {
      method: 'POST',
      headers: { cookie: cookieHeader },
      body: { mode: 'connect', access_key_id: 'AKIATEST', secret_access_key: 'test-secret', bucket },
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

    const response = await $fetch<{ imported: number, albums: number }>('/api/photos/import', {
      method: 'POST',
      headers: { cookie: cookieHeader },
    })

    expect(response).toEqual({ imported: 3, albums: 1 })

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

    const response = await $fetch<{ imported: number, albums: number }>('/api/photos/import', {
      method: 'POST',
      headers: { cookie: cookieHeader },
    })

    expect(response).toEqual({ imported: 1, albums: 1 })

    const albums = await prisma.album.findMany({ where: { admin_id: userId, title: 'holiday' } })
    expect(albums).toHaveLength(1)
  })

  it('re-running the import does not duplicate Photo rows for objects already imported', async () => {
    const { id: userId, cookieHeader } = await createConnectedUser(['holiday/beach.jpg', 'root.png'])

    await $fetch('/api/photos/import', { method: 'POST', headers: { cookie: cookieHeader } })
    const response = await $fetch<{ imported: number, albums: number }>('/api/photos/import', {
      method: 'POST',
      headers: { cookie: cookieHeader },
    })

    expect(response).toEqual({ imported: 2, albums: 1 })

    const photos = await prisma.photo.findMany({ where: { user_id: userId } })
    expect(photos).toHaveLength(2)

    const album = await prisma.album.findFirstOrThrow({ where: { admin_id: userId, title: 'holiday' } })
    const links = await prisma.albumsOnPhotos.findMany({ where: { album_id: album.id } })
    expect(links).toHaveLength(1)
  })

  it('imports nothing from an empty bucket', async () => {
    const { cookieHeader } = await createConnectedUser()

    const response = await $fetch<{ imported: number, albums: number }>('/api/photos/import', {
      method: 'POST',
      headers: { cookie: cookieHeader },
    })

    expect(response).toEqual({ imported: 0, albums: 0 })
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
