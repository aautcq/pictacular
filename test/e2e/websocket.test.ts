import type { AddressInfo } from 'node:net'
import { Buffer } from 'node:buffer'
import { createECDH, randomBytes } from 'node:crypto'
import { createServer as createHttpsServer } from 'node:https'
import process from 'node:process'
import { fetch, setup, url } from '@nuxt/test-utils/e2e'
import selfsigned from 'selfsigned'
import { afterAll, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { prisma } from '../../server/utils/prisma'

// `web-push` always sends over `https`, so the local fake push endpoint
// spun up below needs a cert it'll accept. Setting this explicitly (rather
// than relying on the repo's own dev `.env` setting it) keeps this test
// self-contained regardless of local `.env` contents; it must happen before
// `setup()` spawns the server subprocess below, since that subprocess only
// inherits the env present at spawn time.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

// Black-box tests for the native-WebSocket real-time layer (issue #35),
// replacing the former Socket.IO gateway: a native `WebSocket` connection
// against the Nitro server (authenticated via the same access-token cookie
// HTTP requests use), broadcast behavior, and the push-notification trigger
// path, all exercised over real WS/HTTPS requests rather than mocked
// Prisma/JWT/web-push internals.
describe('websocket real-time layer', async () => {
  await setup()

  const emailPrefix = `ws-${Date.now()}`
  const password = 'Str0ng!Pass'

  function uniqueEmail() {
    return `${emailPrefix}-${Math.random().toString(36).slice(2)}@example.com`
  }

  async function createVerifiedUser() {
    const email = uniqueEmail()
    await fetch('/api/auth/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email,
        first_name: 'John',
        last_name: 'Doe',
        password,
        password_confirmation: password,
      }),
    })

    const user = await prisma.user.findUniqueOrThrow({ where: { email } })
    await fetch(`/api/auth/verify/${user.verification_token}`)

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

  function wsUrl() {
    return url('/ws').replace(/^http/, 'ws')
  }

  function waitForOpen(socket: WebSocket) {
    return new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve())
      socket.once('error', reject)
    })
  }

  function waitForMessage(socket: WebSocket) {
    return new Promise<any>((resolve) => {
      socket.once('message', (data) => {
        resolve(JSON.parse(data.toString()))
      })
    })
  }

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { startsWith: emailPrefix } } })
  })

  it('rejects an unauthenticated upgrade with 401', async () => {
    const socket = new WebSocket(wsUrl())

    const response = await new Promise<{ statusCode?: number }>((resolve) => {
      socket.once('unexpected-response', (_request, res) => resolve(res))
    })

    expect(response.statusCode).toBe(401)
  })

  // #43: a client-supplied `{ type: 'broadcast', name, data }` message used
  // to be relayed verbatim to every connected peer with no authorization or
  // schema check, letting any authenticated peer spoof arbitrary
  // application-level events to every other peer. That message kind was
  // removed entirely (sendMessage is now only reachable from server-side
  // code, never from a client-supplied WS message), so this asserts it's a
  // silent no-op rather than being relayed.
  it('does not relay a client-supplied `broadcast`-shaped message to other peers', async () => {
    const email = await createVerifiedUser()
    const cookieHeader = await loginCookieHeader(email)

    const socketA = new WebSocket(wsUrl(), { headers: { cookie: cookieHeader } })
    const socketB = new WebSocket(wsUrl(), { headers: { cookie: cookieHeader } })

    await Promise.all([waitForOpen(socketA), waitForOpen(socketB)])

    const messageOnB = waitForMessage(socketB)

    socketA.send(JSON.stringify({ type: 'broadcast', name: 'test-event', data: { hello: 'world' } }))

    const outcome = await Promise.race([
      messageOnB.then(() => 'relayed' as const),
      new Promise<'no-op'>(resolve => setTimeout(resolve, 200, 'no-op')),
    ])

    expect(outcome).toBe('no-op')

    socketA.close()
    socketB.close()
  })

  it('silently ignores a `push` message with an invalid shape', async () => {
    const email = await createVerifiedUser()
    const cookieHeader = await loginCookieHeader(email)

    const socket = new WebSocket(wsUrl(), { headers: { cookie: cookieHeader } })
    await waitForOpen(socket)

    // Missing the required `title`/`body` fields — should be rejected by
    // the zod schema and neither crash the connection nor trigger a push.
    socket.send(JSON.stringify({ type: 'push' }))

    const outcome = await Promise.race([
      new Promise<'closed'>(resolve => socket.once('close', () => resolve('closed'))),
      new Promise<'still-open'>(resolve => setTimeout(resolve, 200, 'still-open')),
    ])

    expect(outcome).toBe('still-open')

    socket.close()
  })

  it('triggers a VAPID push notification for the authenticated user\'s subscriptions', async () => {
    const email = await createVerifiedUser()
    const cookieHeader = await loginCookieHeader(email)

    const ecdh = createECDH('prime256v1')
    ecdh.generateKeys()
    const p256dh = ecdh.getPublicKey().toString('base64url')
    const auth = randomBytes(16).toString('base64url')

    // Self-signed cert generated on the fly (rather than committed key/cert
    // files) so the local fake push endpoint below can terminate TLS, since
    // `web-push` always sends over `https`.
    const { private: key, cert } = await selfsigned.generate([{ name: 'commonName', value: '127.0.0.1' }])

    const receivedRequest = new Promise<{ headers: Record<string, string | string[] | undefined>, body: Buffer }>((resolve) => {
      const httpsServer = createHttpsServer({ key, cert }, (request, response) => {
        const chunks: Buffer[] = []
        request.on('data', chunk => chunks.push(chunk))
        request.on('end', () => {
          response.statusCode = 201
          response.end()
          resolve({ headers: request.headers, body: Buffer.concat(chunks) })
          httpsServer.close()
        })
      })

      httpsServer.listen(0, '127.0.0.1', async () => {
        const { port } = httpsServer.address() as AddressInfo

        await fetch('/api/push-subscriptions', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'cookie': cookieHeader },
          body: JSON.stringify({
            endpoint: `https://127.0.0.1:${port}/push`,
            keys: { auth, p256dh },
          }),
        })

        const socket = new WebSocket(wsUrl(), { headers: { cookie: cookieHeader } })
        await waitForOpen(socket)
        socket.send(JSON.stringify({ type: 'push', name: 'test-notification', title: 'Hello', body: 'World' }))
      })
    })

    const { headers, body } = await receivedRequest

    expect(headers.authorization).toMatch(/^vapid /)
    expect(headers['content-encoding']).toBe('aes128gcm')
    expect(body.length).toBeGreaterThan(0)
  })
})
