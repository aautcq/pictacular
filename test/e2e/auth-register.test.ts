import { $fetch, fetch, setup } from '@nuxt/test-utils/e2e'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { prisma } from '../../server/utils/prisma'

// Black-box HTTP tests for register + email verification (issue #29):
// register creates an unverified user and sends a verification email,
// verify marks the account verified given a valid token. Assertions on
// side effects (created user row, is_verified flag) go through Prisma
// directly, since there's no HTTP endpoint yet to read a user back.
describe('register + email verification', async () => {
  await setup()

  const emailPrefix = `jane-${Date.now()}`

  function uniqueEmail() {
    return `${emailPrefix}-${Math.random().toString(36).slice(2)}@example.com`
  }

  function validPayload(overrides: Record<string, unknown> = {}) {
    return {
      email: uniqueEmail(),
      first_name: 'Jane',
      last_name: 'Doe',
      password: 'Str0ng!Pass',
      password_confirmation: 'Str0ng!Pass',
      ...overrides,
    }
  }

  afterAll(async () => {
    await prisma.emailOutbox.deleteMany({ where: { recipient_email: { startsWith: emailPrefix } } })
    await prisma.user.deleteMany({ where: { email: { startsWith: emailPrefix } } })
  })

  it('registers an unverified user with a hashed password and a verification token', async () => {
    const payload = validPayload()

    await $fetch('/api/auth/users', {
      method: 'POST',
      body: payload,
    })

    const user = await prisma.user.findUnique({ where: { email: payload.email } })
    expect(user).toMatchObject({ email: payload.email, is_verified: false })
    expect(user?.password).not.toBe(payload.password)
    expect(user?.verification_token).toBeTruthy()
  })

  // Issue #92: the verification email is routed through the durable
  // outbox instead of a bare sendEmail call. The pending row is written
  // before the response, but the send attempt (and the row's final
  // status) resolves asynchronously afterwards, so poll for it to settle
  // rather than asserting immediately.
  it('creates an outbox row for the verification email reflecting the send outcome', async () => {
    const payload = validPayload()

    await $fetch('/api/auth/users', { method: 'POST', body: payload })

    const outboxRow = await vi.waitFor(async () => {
      const row = await prisma.emailOutbox.findFirstOrThrow({
        where: { recipient_email: payload.email, type: 'verification' },
      })
      expect(row.status).not.toBe('pending')
      return row
    })

    expect(outboxRow).toMatchObject({
      recipient_email: payload.email,
      type: 'verification',
      link: expect.stringContaining('/verification/'),
    })

    // SENDGRID_API_KEY isn't a real key in this environment, so the inline
    // send attempt is expected to fail rather than succeed.
    expect(outboxRow.status).toBe('failed')
    expect(outboxRow.attempts).toBe(1)
    expect(outboxRow.next_attempt_at).toBeTruthy()
    expect(outboxRow.next_attempt_at!.getTime()).toBeGreaterThan(Date.now())
    expect(outboxRow.last_error).toBeTruthy()
  })

  it('rejects registering with a taken email with auth.email_taken', async () => {
    const payload = validPayload()
    await $fetch('/api/auth/users', { method: 'POST', body: payload })

    await expect(
      $fetch('/api/auth/users', { method: 'POST', body: validPayload({ email: payload.email }) }),
    ).rejects.toMatchObject({
      statusCode: 409,
      statusMessage: 'auth.email_taken',
    })
  })

  it('rejects two concurrent registrations for the same email with auth.email_taken', async () => {
    const payload = validPayload()

    const results = await Promise.allSettled([
      $fetch('/api/auth/users', { method: 'POST', body: payload }),
      $fetch('/api/auth/users', { method: 'POST', body: payload }),
    ])

    const rejected = results.filter(result => result.status === 'rejected')
    expect(rejected).toHaveLength(1)
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      statusCode: 409,
      statusMessage: 'auth.email_taken',
    })
  })

  it('rejects a payload with insufficient password complexity', async () => {
    await expect(
      $fetch('/api/auth/users', {
        method: 'POST',
        body: validPayload({ password: 'lowercase', password_confirmation: 'lowercase' }),
      }),
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it('rejects a payload where password and password_confirmation do not match', async () => {
    await expect(
      $fetch('/api/auth/users', {
        method: 'POST',
        body: validPayload({ password_confirmation: 'Different!Pass1' }),
      }),
    ).rejects.toMatchObject({ statusCode: 400 })
  })

  it('verifies an account with a valid token', async () => {
    const payload = validPayload()
    await $fetch('/api/auth/users', { method: 'POST', body: payload })
    const user = await prisma.user.findUniqueOrThrow({ where: { email: payload.email } })

    const response = await $fetch(`/api/auth/verify/${user.verification_token}`)

    expect(response).toBeFalsy()
    const verifiedUser = await prisma.user.findUniqueOrThrow({ where: { email: payload.email } })
    expect(verifiedUser.is_verified).toBe(true)
  })

  it('rejects verification with an unknown token with auth.invalid_token', async () => {
    await expect($fetch('/api/auth/verify/not-a-real-token')).rejects.toMatchObject({
      statusCode: 401,
      statusMessage: 'auth.invalid_token',
    })
  })

  describe('resend verification email', () => {
    it('responds 204 for an unverified account', async () => {
      const payload = validPayload()
      await $fetch('/api/auth/users', { method: 'POST', body: payload })

      const response = await fetch('/api/auth/verify', {
        method: 'POST',
        body: JSON.stringify({ email: payload.email }),
        headers: { 'content-type': 'application/json' },
      })

      expect(response.status).toBe(204)
    })

    it('responds 204 identically for an unknown or already-verified email (no enumeration)', async () => {
      const payload = validPayload()
      await $fetch('/api/auth/users', { method: 'POST', body: payload })
      const user = await prisma.user.findUniqueOrThrow({ where: { email: payload.email } })
      await $fetch(`/api/auth/verify/${user.verification_token}`)

      const verifiedResponse = await fetch('/api/auth/verify', {
        method: 'POST',
        body: JSON.stringify({ email: payload.email }),
        headers: { 'content-type': 'application/json' },
      })
      expect(verifiedResponse.status).toBe(204)

      const unknownResponse = await fetch('/api/auth/verify', {
        method: 'POST',
        body: JSON.stringify({ email: uniqueEmail() }),
        headers: { 'content-type': 'application/json' },
      })
      expect(unknownResponse.status).toBe(204)
    })

    it('rejects an invalid payload', async () => {
      await expect(
        $fetch('/api/auth/verify', { method: 'POST', body: { email: 'not-an-email' } }),
      ).rejects.toMatchObject({ statusCode: 400, statusMessage: 'auth.invalid_payload' })
    })

    // Issue #95: resend-verification is routed through the same durable
    // outbox as registration (issue #92) instead of its own bare
    // sendEmail call, so it also produces a queryable outbox row. Poll for
    // it to settle, same as registration's outbox coverage.
    it('creates an outbox row for the resent verification email reflecting the send outcome', async () => {
      const payload = validPayload()
      await $fetch('/api/auth/users', { method: 'POST', body: payload })

      // Wait for registration's own outbox row to settle first, so the
      // assertions below unambiguously target the resend's row.
      await vi.waitFor(async () => {
        const row = await prisma.emailOutbox.findFirstOrThrow({
          where: { recipient_email: payload.email, type: 'verification' },
        })
        expect(row.status).not.toBe('pending')
      })

      await fetch('/api/auth/verify', {
        method: 'POST',
        body: JSON.stringify({ email: payload.email }),
        headers: { 'content-type': 'application/json' },
      })

      const outboxRow = await vi.waitFor(async () => {
        const rows = await prisma.emailOutbox.findMany({
          where: { recipient_email: payload.email, type: 'verification' },
          orderBy: { created_at: 'asc' },
        })
        expect(rows).toHaveLength(2)
        const [, resendRow] = rows
        expect(resendRow.status).not.toBe('pending')
        return resendRow
      })

      expect(outboxRow).toMatchObject({
        recipient_email: payload.email,
        type: 'verification',
        link: expect.stringContaining('/verification/'),
      })

      // SENDGRID_API_KEY isn't a real key in this environment, so the
      // inline send attempt is expected to fail rather than succeed.
      expect(outboxRow.status).toBe('failed')
      expect(outboxRow.attempts).toBe(1)
      expect(outboxRow.next_attempt_at).toBeTruthy()
      expect(outboxRow.next_attempt_at!.getTime()).toBeGreaterThan(Date.now())
      expect(outboxRow.last_error).toBeTruthy()
    })

    it('does not create an outbox row when resending for an already-verified account', async () => {
      const payload = validPayload()
      await $fetch('/api/auth/users', { method: 'POST', body: payload })
      const user = await prisma.user.findUniqueOrThrow({ where: { email: payload.email } })
      await $fetch(`/api/auth/verify/${user.verification_token}`)

      await fetch('/api/auth/verify', {
        method: 'POST',
        body: JSON.stringify({ email: payload.email }),
        headers: { 'content-type': 'application/json' },
      })

      const rows = await prisma.emailOutbox.findMany({
        where: { recipient_email: payload.email, type: 'verification' },
      })
      // Only registration's own outbox row exists; the resend was a no-op.
      expect(rows).toHaveLength(1)
    })
  })
})
