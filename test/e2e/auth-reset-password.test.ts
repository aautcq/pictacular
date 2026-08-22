import { $fetch, fetch, setup } from '@nuxt/test-utils/e2e'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { comparePassword } from '../../server/utils/crypto'
import { prisma } from '../../server/utils/prisma'

// Black-box HTTP tests for the self-service password-reset flow (issue
// #32): requesting a reset always responds identically regardless of
// whether the email exists/is verified (no account enumeration), a
// valid+verified email gets a reset token and email, setting a new
// password with a valid token succeeds and resets the failed-attempt
// counter, and expired/used/unknown tokens are rejected.
describe('password reset flow', async () => {
  await setup()

  const emailPrefix = `jack-${Date.now()}`
  const password = 'Str0ng!Pass'
  const newPassword = 'N3wStr0ng!Pass'

  function uniqueEmail() {
    return `${emailPrefix}-${Math.random().toString(36).slice(2)}@example.com`
  }

  async function createVerifiedUser(overrides: Record<string, unknown> = {}) {
    const email = uniqueEmail()
    await $fetch('/api/auth/users', {
      method: 'POST',
      body: {
        email,
        first_name: 'Jack',
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

  afterAll(async () => {
    await prisma.emailOutbox.deleteMany({ where: { recipient_email: { startsWith: emailPrefix } } })
    await prisma.user.deleteMany({ where: { email: { startsWith: emailPrefix } } })
  })

  it('responds identically (204) for a nonexistent email as for a valid one', async () => {
    const response = await fetch('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ email: uniqueEmail() }),
      headers: { 'content-type': 'application/json' },
    })

    expect(response.status).toBe(204)
  })

  it('responds identically (204) for an unverified email, without creating a token', async () => {
    const email = uniqueEmail()
    await $fetch('/api/auth/users', {
      method: 'POST',
      body: {
        email,
        first_name: 'Jack',
        last_name: 'Doe',
        password,
        password_confirmation: password,
      },
    })

    const response = await fetch('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
      headers: { 'content-type': 'application/json' },
    })

    expect(response.status).toBe(204)

    const user = await prisma.user.findUniqueOrThrow({ where: { email } })
    const token = await prisma.resetPasswordToken.findFirst({ where: { user_id: user.id } })
    expect(token).toBeNull()
  })

  it('creates a reset token and sends an email for a valid, verified email', async () => {
    const email = await createVerifiedUser()

    const response = await fetch('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
      headers: { 'content-type': 'application/json' },
    })

    expect(response.status).toBe(204)

    const user = await prisma.user.findUniqueOrThrow({ where: { email } })
    const token = await prisma.resetPasswordToken.findFirst({ where: { user_id: user.id } })
    expect(token).toBeTruthy()
    expect(token?.expired).toBe(false)

    // Issue #94: the self-service reset email is routed through the
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
  })

  it('sets a new password with a valid token, resets the failed-attempt counter, and invalidates the token', async () => {
    const email = await createVerifiedUser({ nb_incorrect_passwords: 3 })
    const user = await prisma.user.findUniqueOrThrow({ where: { email } })

    await $fetch('/api/auth/reset-password', { method: 'POST', body: { email } })
    const resetToken = await prisma.resetPasswordToken.findFirstOrThrow({ where: { user_id: user.id } })

    const response = await fetch(`/api/auth/reset-password/${resetToken.token}`, {
      method: 'POST',
      body: JSON.stringify({ password: newPassword, password_confirmation: newPassword }),
      headers: { 'content-type': 'application/json' },
    })

    expect(response.status).toBe(204)

    const updatedUser = await prisma.user.findUniqueOrThrow({ where: { email } })
    expect(comparePassword(newPassword, updatedUser.password)).toBe(true)
    expect(updatedUser.nb_incorrect_passwords).toBe(0)

    const updatedToken = await prisma.resetPasswordToken.findUniqueOrThrow({ where: { id: resetToken.id } })
    expect(updatedToken.expired).toBe(true)

    // The now-current password authenticates; the old one no longer does.
    await expect(
      $fetch('/api/auth/sessions', { method: 'POST', body: { email, password: newPassword } }),
    ).resolves.toMatchObject({ email })
  })

  it('rejects setting a new password with an already-used token', async () => {
    const email = await createVerifiedUser()
    const user = await prisma.user.findUniqueOrThrow({ where: { email } })

    await $fetch('/api/auth/reset-password', { method: 'POST', body: { email } })
    const resetToken = await prisma.resetPasswordToken.findFirstOrThrow({ where: { user_id: user.id } })

    await $fetch(`/api/auth/reset-password/${resetToken.token}`, {
      method: 'POST',
      body: { password: newPassword, password_confirmation: newPassword },
    })

    await expect(
      $fetch(`/api/auth/reset-password/${resetToken.token}`, {
        method: 'POST',
        body: { password: newPassword, password_confirmation: newPassword },
      }),
    ).rejects.toMatchObject({ statusCode: 401, statusMessage: 'auth.invalid_token' })
  })

  it('rejects setting a new password with an expired token', async () => {
    const email = await createVerifiedUser()
    const user = await prisma.user.findUniqueOrThrow({ where: { email } })

    await $fetch('/api/auth/reset-password', { method: 'POST', body: { email } })
    const resetToken = await prisma.resetPasswordToken.findFirstOrThrow({ where: { user_id: user.id } })
    await prisma.resetPasswordToken.update({
      where: { id: resetToken.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    })

    await expect(
      $fetch(`/api/auth/reset-password/${resetToken.token}`, {
        method: 'POST',
        body: { password: newPassword, password_confirmation: newPassword },
      }),
    ).rejects.toMatchObject({ statusCode: 401, statusMessage: 'auth.invalid_token' })
  })

  it('rejects setting a new password with an unknown token', async () => {
    await expect(
      $fetch('/api/auth/reset-password/not-a-real-token', {
        method: 'POST',
        body: { password: newPassword, password_confirmation: newPassword },
      }),
    ).rejects.toMatchObject({ statusCode: 401, statusMessage: 'auth.invalid_token' })
  })

  it('rejects a mismatched password confirmation with 400', async () => {
    const email = await createVerifiedUser()
    const user = await prisma.user.findUniqueOrThrow({ where: { email } })

    await $fetch('/api/auth/reset-password', { method: 'POST', body: { email } })
    const resetToken = await prisma.resetPasswordToken.findFirstOrThrow({ where: { user_id: user.id } })

    await expect(
      $fetch(`/api/auth/reset-password/${resetToken.token}`, {
        method: 'POST',
        body: { password: newPassword, password_confirmation: 'does-not-match' },
      }),
    ).rejects.toMatchObject({ statusCode: 400, statusMessage: 'auth.invalid_payload' })
  })

  it('rejects an insufficiently complex new password with 400', async () => {
    const email = await createVerifiedUser()
    const user = await prisma.user.findUniqueOrThrow({ where: { email } })

    await $fetch('/api/auth/reset-password', { method: 'POST', body: { email } })
    const resetToken = await prisma.resetPasswordToken.findFirstOrThrow({ where: { user_id: user.id } })

    await expect(
      $fetch(`/api/auth/reset-password/${resetToken.token}`, {
        method: 'POST',
        body: { password: 'weakpassword', password_confirmation: 'weakpassword' },
      }),
    ).rejects.toMatchObject({ statusCode: 400, statusMessage: 'auth.invalid_payload' })
  })
})
