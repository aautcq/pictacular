import { $fetch, fetch, setup } from '@nuxt/test-utils/e2e'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { accessTokenCookieName, refreshTokenCookieName } from '../../server/utils/cookies'
import { encodeAwsCredentials } from '../../server/utils/jwt'
import { prisma } from '../../server/utils/prisma'

// Black-box HTTP tests for login + logout + session lifecycle + lockout
// (issue #30): 5 incorrect passwords lock the account and trigger a
// password-reset email, success resets the counter, creates a session
// while revoking others, sets both auth cookies, and returns a signed
// avatar URL when applicable; logout deactivates the session and clears
// the cookies.
describe('login + logout + session lifecycle + lockout', async () => {
  await setup()

  const emailPrefix = `john-${Date.now()}`
  const password = 'Str0ng!Pass'

  function uniqueEmail() {
    return `${emailPrefix}-${Math.random().toString(36).slice(2)}@example.com`
  }

  async function createVerifiedUser(overrides: Record<string, unknown> = {}) {
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

    if (Object.keys(overrides).length > 0)
      await prisma.user.update({ where: { id: user.id }, data: overrides })

    return email
  }

  function getCookies(response: Response) {
    return response.headers.getSetCookie()
  }

  afterAll(async () => {
    await prisma.emailOutbox.deleteMany({ where: { recipient_email: { startsWith: emailPrefix } } })
    await prisma.user.deleteMany({ where: { email: { startsWith: emailPrefix } } })
  })

  it('rejects login with a wrong password and increments the failed-attempt counter', async () => {
    const email = await createVerifiedUser()

    await expect(
      $fetch('/api/auth/sessions', { method: 'POST', body: { email, password: 'wrong-password' } }),
    ).rejects.toMatchObject({ statusCode: 401, statusMessage: 'auth.invalid_credentials' })

    const user = await prisma.user.findUniqueOrThrow({ where: { email } })
    expect(user.nb_incorrect_passwords).toBe(1)
  })

  it('locks the account on the 5th incorrect password and sends a password-reset email', async () => {
    const email = await createVerifiedUser()

    for (let i = 0; i < 5; i++) {
      await expect(
        $fetch('/api/auth/sessions', { method: 'POST', body: { email, password: 'wrong-password' } }),
      ).rejects.toMatchObject({ statusCode: 401, statusMessage: 'auth.invalid_credentials' })
    }

    const user = await prisma.user.findUniqueOrThrow({ where: { email } })
    expect(user.nb_incorrect_passwords).toBe(5)

    const resetToken = await prisma.resetPasswordToken.findFirst({
      where: { user_id: user.id },
      orderBy: { created_at: 'desc' },
    })
    expect(resetToken).toBeTruthy()

    // Issue #94: the lockout's password-reset email is routed through the
    // durable outbox instead of a bare sendEmail call, so poll for the
    // pending row to settle rather than asserting immediately.
    const outboxRow = await vi.waitFor(async () => {
      const row = await prisma.emailOutbox.findFirstOrThrow({
        where: { recipient_email: email, type: 'password-reset' },
      })
      expect(row.status).not.toBe('pending')
      return row
    })
    expect(outboxRow).toMatchObject({
      recipient_email: email,
      type: 'password-reset',
      link: expect.stringContaining('/reset-password/'),
    })

    // Locked out: even the correct password is now rejected.
    await expect(
      $fetch('/api/auth/sessions', { method: 'POST', body: { email, password } }),
    ).rejects.toMatchObject({ statusCode: 401, statusMessage: 'auth.invalid_credentials' })
  })

  it('resets the failed-attempt counter to zero on a successful login after a previous failure', async () => {
    const email = await createVerifiedUser()

    await expect(
      $fetch('/api/auth/sessions', { method: 'POST', body: { email, password: 'wrong-password' } }),
    ).rejects.toMatchObject({ statusCode: 401 })

    await $fetch('/api/auth/sessions', { method: 'POST', body: { email, password } })

    const user = await prisma.user.findUniqueOrThrow({ where: { email } })
    expect(user.nb_incorrect_passwords).toBe(0)
  })

  it('rejects login with an unverified account identically to invalid credentials', async () => {
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

    await expect(
      $fetch('/api/auth/sessions', { method: 'POST', body: { email, password } }),
    ).rejects.toMatchObject({ statusCode: 401, statusMessage: 'auth.invalid_credentials' })
  })

  it('creates a session, revokes other active sessions, updates last_sign_in_at, and sets both auth cookies on success', async () => {
    const email = await createVerifiedUser()
    const user = await prisma.user.findUniqueOrThrow({ where: { email } })

    const staleSession = await prisma.session.create({
      data: { active: true, user: { connect: { id: user.id } } },
    })

    const response = await fetch('/api/auth/sessions', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
      headers: { 'content-type': 'application/json' },
    })

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({ email, has_aws_credentials: false, avatar_url: null })

    const cookies = getCookies(response)
    expect(cookies.some(cookie => cookie.startsWith(`${accessTokenCookieName}=`))).toBe(true)
    expect(cookies.some(cookie => cookie.startsWith(`${refreshTokenCookieName}=`))).toBe(true)

    // Codifies the unchanged production cookie behavior (issue #72): this
    // default (built, non-dev) test run must keep issuing `Secure`/`SameSite=None`
    // auth cookies.
    for (const cookie of cookies) {
      expect(cookie).toMatch(/Secure/i)
      expect(cookie).toMatch(/SameSite=None/i)
    }

    const refreshedStaleSession = await prisma.session.findUniqueOrThrow({ where: { id: staleSession.id } })
    expect(refreshedStaleSession.active).toBe(false)

    const updatedUser = await prisma.user.findUniqueOrThrow({ where: { email } })
    expect(updatedUser.last_sign_in_at).toBeTruthy()

    const activeSessions = await prisma.session.findMany({ where: { user_id: user.id, active: true } })
    expect(activeSessions).toHaveLength(1)
  })

  it('returns a signed avatar URL when the user has AWS credentials and an avatar set', async () => {
    const email = await createVerifiedUser({ avatar_url: 'avatar.jpg' })
    const user = await prisma.user.findUniqueOrThrow({ where: { email } })

    await prisma.awsCredentials.create({
      data: {
        bucket: 'pictacular-test-bucket',
        region: 'eu-west-3',
        tokens: encodeAwsCredentials({ access_key_id: 'AKIATEST', secret_access_key: 'test-secret' }),
        user: { connect: { id: user.id } },
      },
    })

    const response = await $fetch<{ has_aws_credentials: boolean, avatar_url: string | null }>(
      '/api/auth/sessions',
      { method: 'POST', body: { email, password } },
    )

    expect(response.has_aws_credentials).toBe(true)
    expect(response.avatar_url).toMatch(/^https:\/\/pictacular-test-bucket\.s3\./)
  })

  it('logs out an authenticated session, deactivating it and clearing both cookies', async () => {
    const email = await createVerifiedUser()

    const loginResponse = await fetch('/api/auth/sessions', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
      headers: { 'content-type': 'application/json' },
    })
    const cookieHeader = getCookies(loginResponse)
      .map(cookie => cookie.split(';')[0])
      .join('; ')

    const user = await prisma.user.findUniqueOrThrow({ where: { email } })
    const sessionBeforeLogout = await prisma.session.findFirstOrThrow({ where: { user_id: user.id, active: true } })

    const logoutResponse = await fetch('/api/auth/logout', {
      method: 'POST',
      headers: { cookie: cookieHeader },
    })

    expect(logoutResponse.status).toBe(204)

    const clearedCookies = getCookies(logoutResponse)
    expect(clearedCookies.some(cookie => cookie.startsWith(`${accessTokenCookieName}=;`))).toBe(true)
    expect(clearedCookies.some(cookie => cookie.startsWith(`${refreshTokenCookieName}=;`))).toBe(true)

    const sessionAfterLogout = await prisma.session.findUniqueOrThrow({ where: { id: sessionBeforeLogout.id } })
    expect(sessionAfterLogout.active).toBe(false)
  })

  it('rejects an unauthenticated logout', async () => {
    await expect($fetch('/api/auth/logout', { method: 'POST' })).rejects.toMatchObject({ statusCode: 401 })
  })
})
