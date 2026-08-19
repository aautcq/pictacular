import { $fetch, fetch, setup } from '@nuxt/test-utils/e2e'
import { afterAll, describe, expect, it } from 'vitest'
import { encodeAwsCredentials } from '../../server/utils/jwt'
import { prisma } from '../../server/utils/prisma'

// Black-box HTTP tests for authenticated self-service profile management
// (issue #33): get/update/delete one's own account via /api/users/me.
describe('user profile self-service', async () => {
  await setup()

  const emailPrefix = `profile-${Date.now()}`
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

  async function loginCookieHeader(email: string) {
    const loginResponse = await fetch('/api/auth/sessions', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
      headers: { 'content-type': 'application/json' },
    })

    return getCookies(loginResponse)
      .map(cookie => cookie.split(';')[0])
      .join('; ')
  }

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { startsWith: emailPrefix } } })
  })

  describe('get profile', () => {
    it('returns id, email, created_at, last_sign_in_at for the authenticated user', async () => {
      const email = await createVerifiedUser()
      const cookieHeader = await loginCookieHeader(email)

      const response = await $fetch('/api/users/me', {
        headers: { cookie: cookieHeader },
      })

      const user = await prisma.user.findUniqueOrThrow({ where: { email } })
      expect(response).toEqual({
        id: user.id,
        email: user.email,
        created_at: user.created_at.toISOString(),
        last_sign_in_at: user.last_sign_in_at?.toISOString(),
      })
    })

    it('rejects an unauthenticated request with 401', async () => {
      await expect($fetch('/api/users/me')).rejects.toMatchObject({ statusCode: 401 })
    })
  })

  describe('update profile', () => {
    it('persists changes for the authenticated user only', async () => {
      const email = await createVerifiedUser()
      const cookieHeader = await loginCookieHeader(email)

      const response = await $fetch('/api/users/me', {
        method: 'PATCH',
        headers: { cookie: cookieHeader },
        body: { first_name: 'Jane', last_name: 'Smith' },
      })

      expect(response).toMatchObject({ first_name: 'Jane', last_name: 'Smith' })

      const user = await prisma.user.findUniqueOrThrow({ where: { email } })
      expect(user.first_name).toBe('Jane')
      expect(user.last_name).toBe('Smith')
    })

    it('updates the password when password and password_confirmation match', async () => {
      const email = await createVerifiedUser()
      const cookieHeader = await loginCookieHeader(email)
      const newPassword = 'Ev3nStr0nger!'

      await $fetch('/api/users/me', {
        method: 'PATCH',
        headers: { cookie: cookieHeader },
        body: { current_password: password, password: newPassword, password_confirmation: newPassword },
      })

      await expect(
        $fetch('/api/auth/sessions', { method: 'POST', body: { email, password: newPassword } }),
      ).resolves.toMatchObject({ email })
    })

    it('rejects a password change without the correct current_password', async () => {
      const email = await createVerifiedUser()
      const cookieHeader = await loginCookieHeader(email)

      await expect(
        $fetch('/api/users/me', {
          method: 'PATCH',
          headers: { cookie: cookieHeader },
          body: { current_password: 'wrong-password', password: 'N3wStr0ng!Pass', password_confirmation: 'N3wStr0ng!Pass' },
        }),
      ).rejects.toMatchObject({ statusCode: 401, statusMessage: 'auth.invalid_credentials' })
    })

    it('rejects a password change missing current_password', async () => {
      const email = await createVerifiedUser()
      const cookieHeader = await loginCookieHeader(email)

      await expect(
        $fetch('/api/users/me', {
          method: 'PATCH',
          headers: { cookie: cookieHeader },
          body: { password: 'N3wStr0ng!Pass', password_confirmation: 'N3wStr0ng!Pass' },
        }),
      ).rejects.toMatchObject({ statusCode: 400, statusMessage: 'users.invalid_payload' })
    })

    it('rejects a payload where password and password_confirmation do not match', async () => {
      const email = await createVerifiedUser()
      const cookieHeader = await loginCookieHeader(email)

      await expect(
        $fetch('/api/users/me', {
          method: 'PATCH',
          headers: { cookie: cookieHeader },
          body: { current_password: password, password: 'Str0ng!Pass2', password_confirmation: 'Different!Pass2' },
        }),
      ).rejects.toMatchObject({ statusCode: 400, statusMessage: 'users.invalid_payload' })
    })

    it('rejects an email already taken by another account', async () => {
      const email = await createVerifiedUser()
      const otherEmail = await createVerifiedUser()
      const cookieHeader = await loginCookieHeader(email)

      await expect(
        $fetch('/api/users/me', {
          method: 'PATCH',
          headers: { cookie: cookieHeader },
          body: { email: otherEmail },
        }),
      ).rejects.toMatchObject({ statusCode: 409, statusMessage: 'auth.email_taken' })
    })

    it('rejects an unauthenticated request with 401', async () => {
      await expect(
        $fetch('/api/users/me', { method: 'PATCH', body: { first_name: 'Jane' } }),
      ).rejects.toMatchObject({ statusCode: 401 })
    })
  })

  describe('delete account', () => {
    it('removes the user and all related rows, clears cookies, and blocks future logins', async () => {
      const email = await createVerifiedUser()
      const cookieHeader = await loginCookieHeader(email)
      const user = await prisma.user.findUniqueOrThrow({ where: { email } })

      await prisma.biometrics.create({
        data: { credential_id: `cred-${user.id}`, pem: 'pem', counter: 0, user: { connect: { id: user.id } } },
      })
      await prisma.pushSubscription.create({
        data: { endpoint: 'https://push.example.com', keys: '{}', user: { connect: { id: user.id } } },
      })
      await prisma.resetPasswordToken.create({
        data: { token: `token-${user.id}`, expiresAt: new Date(), user: { connect: { id: user.id } } },
      })
      await prisma.awsCredentials.create({
        data: {
          bucket: 'pictacular-test-bucket',
          region: 'eu-west-3',
          tokens: encodeAwsCredentials({ access_key_id: 'AKIATEST', secret_access_key: 'test-secret' }),
          user: { connect: { id: user.id } },
        },
      })

      const response = await fetch('/api/users/me', {
        method: 'DELETE',
        headers: { cookie: cookieHeader },
      })

      expect(response.status).toBe(204)

      const clearedCookies = getCookies(response)
      expect(clearedCookies.some(cookie => cookie.startsWith(`pictacularAccTok=;`))).toBe(true)
      expect(clearedCookies.some(cookie => cookie.startsWith(`pictacularRefTok=;`))).toBe(true)

      await expect(prisma.user.findUnique({ where: { id: user.id } })).resolves.toBeNull()
      await expect(prisma.session.findMany({ where: { user_id: user.id } })).resolves.toHaveLength(0)
      await expect(prisma.biometrics.findMany({ where: { user_id: user.id } })).resolves.toHaveLength(0)
      await expect(prisma.pushSubscription.findMany({ where: { user_id: user.id } })).resolves.toHaveLength(0)
      await expect(prisma.resetPasswordToken.findMany({ where: { user_id: user.id } })).resolves.toHaveLength(0)
      await expect(prisma.awsCredentials.findUnique({ where: { user_id: user.id } })).resolves.toBeNull()

      await expect(
        $fetch('/api/auth/sessions', { method: 'POST', body: { email, password } }),
      ).rejects.toMatchObject({ statusCode: 401, statusMessage: 'auth.invalid_credentials' })
    })

    it('rejects an unauthenticated request with 401', async () => {
      await expect($fetch('/api/users/me', { method: 'DELETE' })).rejects.toMatchObject({ statusCode: 401 })
    })
  })
})
