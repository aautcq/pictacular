import type { AddressInfo } from 'node:net'
import type { FakeS3Server } from './fake-s3-server'
import { createECDH, randomBytes } from 'node:crypto'
import { createServer as createHttpsServer } from 'node:https'
import process from 'node:process'
import { $fetch, fetch, setup, url } from '@nuxt/test-utils/e2e'
import selfsigned from 'selfsigned'
import { afterAll, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import archivedPhotosScanTask from '../../server/tasks/archived-photos/scan'
import { prisma } from '../../server/utils/prisma'
import { badRoleArn, startFakeS3Server, testExternalId, testRoleArn } from './fake-s3-server'

// `web-push` always sends over `https` — see websocket.test.ts's own
// identical setup comment for why this has to be set before `setup()`
// spawns the server subprocess below.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

// There's no HTTP entry point for a scheduled task (issue #97's own
// precedent, followed here for issue #145's scan task too) — most of this
// spec invokes the task's `run()` directly, the one documented exception to
// this repo's HTTP-only black-box convention (see
// test/e2e/email-outbox-task.test.ts). That direct invocation runs inside
// the Vitest process itself though, entirely separate from the live
// `@nuxt/test-utils`-booted server subprocess that owns the real WS peer
// registry (server/utils/websocket.ts) — fine for asserting DB state, but
// unable to ever deliver a real WS message to a client socket connected to
// that other process. The one test below that asserts real WS + push
// delivery instead boots the server with `dev: true` and drives the task
// through Nitro's own dev-only `/_nitro/tasks/:name` HTTP endpoint
// (enabled by this app's `experimental.tasks: true`, nuxt.config.ts), so
// the task runs inside the same process as the live WS connection.
async function runArchivedPhotosScanTask() {
  return archivedPhotosScanTask.run({ name: 'archived-photos:scan', payload: {}, context: {} })
}

describe('archived photos scan scheduled task', async () => {
  const fakeS3: FakeS3Server = await startFakeS3Server()
  process.env.AWS_S3_ENDPOINT = fakeS3.url

  await setup({ dev: true })

  const emailPrefix = `archived-photos-task-${Date.now()}`
  const password = 'Str0ng!Pass'

  function uniqueEmail() {
    return `${emailPrefix}-${Math.random().toString(36).slice(2)}@example.com`
  }

  function uniqueBucketName() {
    return `archived-task-bucket-${Math.random().toString(36).slice(2)}`
  }

  async function createConnectedUser() {
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

    return { id: user.id, email, bucket }
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

  async function createPhotoRow(userId: number, key: string, overrides: Record<string, unknown> = {}) {
    return prisma.photo.create({
      data: {
        key,
        mime_type: 'image/jpeg',
        size: 1,
        last_modified: new Date(),
        user: { connect: { id: userId } },
        ...overrides,
      },
    })
  }

  afterAll(async () => {
    const users = await prisma.user.findMany({ where: { email: { startsWith: emailPrefix } } })
    await prisma.photo.deleteMany({ where: { user_id: { in: users.map(user => user.id) } } })
    await prisma.user.deleteMany({ where: { email: { startsWith: emailPrefix } } })
    await fakeS3.close()
  })

  it('persists the storage class + restore status for an Archived Photo from a fresh scan', async () => {
    const { id: userId, bucket } = await createConnectedUser()
    fakeS3.seedBucket(bucket, [{ key: 'photo.jpg', storageClass: 'GLACIER' }])
    const photo = await createPhotoRow(userId, 'photo.jpg')

    await runArchivedPhotosScanTask()

    const updated = await prisma.photo.findUniqueOrThrow({ where: { id: photo.id } })
    expect(updated.storage_class).toBe('GLACIER')
    expect(updated.restore_ongoing).toBe(false)
    expect(updated.restore_expires_at).toBeNull()
  })

  it('persists an in-progress Restore Request\'s status', async () => {
    const { id: userId, bucket } = await createConnectedUser()
    fakeS3.seedBucket(bucket, [{ key: 'photo.jpg', storageClass: 'DEEP_ARCHIVE', restoreOngoing: true }])
    const photo = await createPhotoRow(userId, 'photo.jpg', { storage_class: 'DEEP_ARCHIVE' })

    await runArchivedPhotosScanTask()

    const updated = await prisma.photo.findUniqueOrThrow({ where: { id: photo.id } })
    expect(updated.restore_ongoing).toBe(true)
  })

  it('leaves a non-archived Photo\'s state untouched (STANDARD storage class)', async () => {
    const { id: userId, bucket } = await createConnectedUser()
    fakeS3.seedBucket(bucket, [{ key: 'photo.jpg', storageClass: 'STANDARD' }])
    const photo = await createPhotoRow(userId, 'photo.jpg')

    await runArchivedPhotosScanTask()

    const updated = await prisma.photo.findUniqueOrThrow({ where: { id: photo.id } })
    expect(updated.storage_class).toBe('STANDARD')
    expect(updated.restore_ongoing).toBe(false)
  })

  it('sends a WS + push notification exactly once when a Restore Request transitions to completed', async () => {
    const { id: userId, email, bucket } = await createConnectedUser()
    const restoreExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
    fakeS3.seedBucket(bucket, [{ key: 'photo.jpg', storageClass: 'GLACIER', restoreExpiresAt }])
    const photo = await createPhotoRow(userId, 'photo.jpg', { storage_class: 'GLACIER', restore_ongoing: true })

    // Real WS connection (server/utils/websocket.ts#sendMessageToUser only
    // reaches currently-open peers) and a real fake-HTTPS push endpoint
    // (web-push always sends over https), mirroring websocket.test.ts's
    // own "triggers a VAPID push notification" test — no mocking of this
    // app's own server/utils modules.
    const ecdh = createECDH('prime256v1')
    ecdh.generateKeys()
    const p256dh = ecdh.getPublicKey().toString('base64url')
    const auth = randomBytes(16).toString('base64url')
    const { private: key, cert } = await selfsigned.generate([{ name: 'commonName', value: '127.0.0.1' }])

    let pushRequestCount = 0
    const httpsServer = createHttpsServer({ key, cert }, (request, response) => {
      request.on('data', () => {})
      request.on('end', () => {
        pushRequestCount += 1
        response.statusCode = 201
        response.end()
      })
    })
    await new Promise<void>(resolve => httpsServer.listen(0, '127.0.0.1', resolve))
    const { port } = httpsServer.address() as AddressInfo

    await prisma.pushSubscription.create({
      data: {
        endpoint: `https://127.0.0.1:${port}/push`,
        keys: JSON.stringify({ auth, p256dh }),
        user: { connect: { id: userId } },
      },
    })

    const cookieHeader = await loginCookieHeader(email)
    const socket = new WebSocket(url('/ws').replace(/^http/, 'ws'), { headers: { cookie: cookieHeader } })
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve())
      socket.once('error', reject)
    })
    const messageReceived = new Promise<any>((resolve) => {
      socket.once('message', data => resolve(JSON.parse(data.toString())))
    })

    // Triggered through the dev-only task HTTP endpoint (see the top of
    // this file), not `runArchivedPhotosScanTask()`, so the task actually
    // runs inside the same process as the WS connection above.
    await $fetch('/_nitro/tasks/archived-photos:scan', { method: 'POST' })

    const message = await messageReceived
    expect(message.name).toBe('photo:restored')
    expect(message.data.id).toBe(photo.id)
    expect(message.data.archived_state).toBe('restored')
    expect(pushRequestCount).toBe(1)

    // Re-running the (idempotent) task must not double-notify (issue
    // #145's story 14) now that the Photo's own restore_ongoing has
    // already flipped to false.
    await $fetch('/_nitro/tasks/archived-photos:scan', { method: 'POST' })
    expect(pushRequestCount).toBe(1)

    socket.close()
    await new Promise<void>((resolve, reject) => httpsServer.close(error => (error ? reject(error) : resolve())))
  })

  it('does not throw when one User\'s Storage Connection fails, and still scans the others', async () => {
    const broken = await createConnectedUser()
    await prisma.storageConnection.update({
      where: { user_id: broken.id },
      data: { role_arn: badRoleArn },
    })
    fakeS3.seedBucket(broken.bucket, [{ key: 'photo.jpg', storageClass: 'GLACIER' }])
    await createPhotoRow(broken.id, 'photo.jpg')

    const healthy = await createConnectedUser()
    fakeS3.seedBucket(healthy.bucket, [{ key: 'photo.jpg', storageClass: 'GLACIER' }])
    const healthyPhoto = await createPhotoRow(healthy.id, 'photo.jpg')

    await expect(runArchivedPhotosScanTask()).resolves.toEqual({ result: 'success' })

    const updated = await prisma.photo.findUniqueOrThrow({ where: { id: healthyPhoto.id } })
    expect(updated.storage_class).toBe('GLACIER')
  })
})
