import { $fetch, fetch, setup } from '@nuxt/test-utils/e2e'
import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '../../server/utils/prisma'

// Black-box HTTP tests for push-subscription registration (issue #35):
// an authenticated user can register a push subscription (endpoint + keys)
// for later use by the VAPID web-push trigger path.
describe('push subscription registration', async () => {
  await setup()

  const emailPrefix = `push-sub-${Date.now()}`
  const password = 'Str0ng!Pass'

  function uniqueEmail() {
    return `${emailPrefix}-${Math.random().toString(36).slice(2)}@example.com`
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

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { startsWith: emailPrefix } } })
  })

  it('persists the endpoint and keys for the authenticated user', async () => {
    const email = await createVerifiedUser()
    const cookieHeader = await loginCookieHeader(email)

    const response = await fetch('/api/push-subscriptions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cookie': cookieHeader },
      body: JSON.stringify({
        endpoint: 'https://push.example.com/subscription/abc',
        keys: { auth: 'auth-secret', p256dh: 'p256dh-public-key' },
      }),
    })

    expect(response.status).toBe(201)
    const body = await response.json()

    const user = await prisma.user.findUniqueOrThrow({ where: { email } })
    const subscription = await prisma.pushSubscription.findUniqueOrThrow({ where: { id: body.id } })

    expect(subscription.user_id).toBe(user.id)
    expect(subscription.endpoint).toBe('https://push.example.com/subscription/abc')
    expect(JSON.parse(subscription.keys)).toEqual({ auth: 'auth-secret', p256dh: 'p256dh-public-key' })
  })

  it('rejects an unauthenticated request with 401', async () => {
    await expect(
      $fetch('/api/push-subscriptions', {
        method: 'POST',
        body: { endpoint: 'https://push.example.com/subscription/abc', keys: { auth: 'a', p256dh: 'b' } },
      }),
    ).rejects.toMatchObject({ statusCode: 401 })
  })

  it('rejects an invalid payload with 400', async () => {
    const email = await createVerifiedUser()
    const cookieHeader = await loginCookieHeader(email)

    await expect(
      $fetch('/api/push-subscriptions', {
        method: 'POST',
        headers: { cookie: cookieHeader },
        body: { endpoint: 'not-a-url', keys: { auth: 'a' } },
      }),
    ).rejects.toMatchObject({ statusCode: 400, statusMessage: 'push_subscriptions.invalid_payload' })
  })
})
