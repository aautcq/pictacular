import { fetch, setup } from '@nuxt/test-utils/e2e'
import { afterAll, describe, expect, it } from 'vitest'
import { prisma } from '../../server/utils/prisma'

// Codifies the dev-mode auth cookie behavior introduced for issue #72:
// booting the app with `dev: true` (matching `npm run dev`, plain
// `http://localhost`) must issue `SameSite=Lax`, non-`Secure` cookies so
// login actually works over HTTP, instead of the `Secure`/`SameSite=None`
// pair used in production (see the sibling test in auth-login.test.ts).
describe('login sets dev-mode auth cookies', async () => {
  await setup({ dev: true })

  const emailPrefix = `john-dev-${Date.now()}`
  const password = 'Str0ng!Pass'

  function uniqueEmail() {
    return `${emailPrefix}-${Math.random().toString(36).slice(2)}@example.com`
  }

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { startsWith: emailPrefix } } })
  })

  it('sets non-Secure, SameSite=Lax cookies on successful login', async () => {
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

    const response = await fetch('/api/auth/sessions', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
      headers: { 'content-type': 'application/json' },
    })

    expect(response.status).toBe(201)

    const cookies = response.headers.getSetCookie()
    expect(cookies.length).toBeGreaterThan(0)
    for (const cookie of cookies) {
      expect(cookie).not.toMatch(/Secure/i)
      expect(cookie).toMatch(/SameSite=Lax/i)
    }
  })
})
