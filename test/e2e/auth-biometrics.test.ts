import { $fetch, fetch, setup } from '@nuxt/test-utils/e2e'
import { afterAll, describe, expect, it } from 'vitest'
import { accessTokenCookieName, refreshTokenCookieName, webauthnChallengeCookieName } from '../../server/utils/cookies'
import { prisma } from '../../server/utils/prisma'
import { createVirtualAuthenticator } from './webauthn-authenticator'

// Black-box HTTP tests for WebAuthn biometrics registration + login (issue
// #34): an authenticated user can fetch registration options and register a
// credential, an unauthenticated visitor can fetch assertion options, a
// successful assertion logs in with the exact same side effects as password
// login, and an unknown credential ID or a failed assertion is rejected.
describe('biometrics (webauthn) registration + login', async () => {
  await setup()

  const emailPrefix = `biometrics-${Date.now()}`
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

  function getCookies(response: Response) {
    return response.headers.getSetCookie()
  }

  function cookieHeaderFrom(cookies: string[]) {
    return cookies.map(cookie => cookie.split(';')[0]).join('; ')
  }

  async function loginCookieHeader(email: string) {
    const loginResponse = await fetch('/api/auth/sessions', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
      headers: { 'content-type': 'application/json' },
    })

    return cookieHeaderFrom(getCookies(loginResponse))
  }

  function challengeCookie(cookies: string[]) {
    const cookie = cookies.find(cookie => cookie.startsWith(`${webauthnChallengeCookieName}=`))
    return cookie ? cookie.split(';')[0] : undefined
  }

  // Registers a fresh biometric credential for a freshly-verified user,
  // returning both the email (for password-login assertions in other tests)
  // and the virtual authenticator so a later test can assert with it.
  async function registerBiometrics() {
    const email = await createVerifiedUser()
    const authCookieHeader = await loginCookieHeader(email)

    const optionsResponse = await fetch('/api/auth/biometrics/registration-options', {
      headers: { cookie: authCookieHeader },
    })
    const options = await optionsResponse.json()
    const challenge = challengeCookie(getCookies(optionsResponse))

    const authenticator = createVirtualAuthenticator()
    const registrationResponse = authenticator.createRegistrationResponse(
      options.rp.id,
      new URL(optionsResponse.url).origin,
      options.challenge,
    )

    const registerResponse = await fetch('/api/auth/biometrics', {
      method: 'POST',
      body: JSON.stringify(registrationResponse),
      headers: {
        'content-type': 'application/json',
        'cookie': [authCookieHeader, challenge].filter(Boolean).join('; '),
      },
    })

    return { email, authenticator, registerResponse, rpId: options.rp.id as string }
  }

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { startsWith: emailPrefix } } })
  })

  describe('registration-options', () => {
    it('returns WebAuthn registration options for the authenticated user and stashes a challenge cookie', async () => {
      const email = await createVerifiedUser()
      const authCookieHeader = await loginCookieHeader(email)

      const response = await fetch('/api/auth/biometrics/registration-options', {
        headers: { cookie: authCookieHeader },
      })

      expect(response.status).toBe(200)
      const options = await response.json()
      expect(options.user.name).toBe(email)
      expect(challengeCookie(getCookies(response))).toBeTruthy()
    })

    it('rejects an unauthenticated request with 401', async () => {
      await expect($fetch('/api/auth/biometrics/registration-options')).rejects.toMatchObject({ statusCode: 401 })
    })
  })

  describe('register credential', () => {
    it('stores a new biometric credential for the authenticated user', async () => {
      const { email, registerResponse } = await registerBiometrics()

      expect(registerResponse.status).toBe(201)
      const body = await registerResponse.json()
      expect(body.credential_id).toBeTruthy()

      const user = await prisma.user.findUniqueOrThrow({ where: { email } })
      const biometrics = await prisma.biometrics.findUnique({ where: { credential_id: body.credential_id } })
      expect(biometrics?.user_id).toBe(user.id)
    })
  })

  describe('assertion-options', () => {
    it('returns WebAuthn assertion options for an unauthenticated visitor and stashes a challenge cookie', async () => {
      const response = await fetch('/api/auth/biometrics/assertion-options')

      expect(response.status).toBe(200)
      const options = await response.json()
      expect(options.challenge).toBeTruthy()
      expect(challengeCookie(getCookies(response))).toBeTruthy()
    })
  })

  describe('verify assertion', () => {
    it('logs the user in with the same side effects as password login on a successful assertion', async () => {
      const { email, authenticator, rpId } = await registerBiometrics()
      const user = await prisma.user.findUniqueOrThrow({ where: { email } })

      const staleSession = await prisma.session.create({
        data: { active: true, user: { connect: { id: user.id } } },
      })

      const optionsResponse = await fetch('/api/auth/biometrics/assertion-options')
      const options = await optionsResponse.json()
      const challenge = challengeCookie(getCookies(optionsResponse))

      const assertionResponse = authenticator.createAssertionResponse(
        rpId,
        new URL(optionsResponse.url).origin,
        options.challenge,
      )

      const verifyResponse = await fetch('/api/auth/biometrics/verify', {
        method: 'POST',
        body: JSON.stringify(assertionResponse),
        headers: { 'content-type': 'application/json', 'cookie': challenge ?? '' },
      })

      expect(verifyResponse.status).toBe(201)
      await expect(verifyResponse.json()).resolves.toMatchObject({ email })

      const cookies = getCookies(verifyResponse)
      expect(cookies.some(cookie => cookie.startsWith(`${accessTokenCookieName}=`))).toBe(true)
      expect(cookies.some(cookie => cookie.startsWith(`${refreshTokenCookieName}=`))).toBe(true)

      const refreshedStaleSession = await prisma.session.findUniqueOrThrow({ where: { id: staleSession.id } })
      expect(refreshedStaleSession.active).toBe(false)

      const activeSessions = await prisma.session.findMany({ where: { user_id: user.id, active: true } })
      expect(activeSessions).toHaveLength(1)

      const updatedUser = await prisma.user.findUniqueOrThrow({ where: { email } })
      expect(updatedUser.last_sign_in_at).toBeTruthy()
    })

    it('rejects an assertion with an unknown credential ID as unauthorized', async () => {
      const authenticator = createVirtualAuthenticator()

      const optionsResponse = await fetch('/api/auth/biometrics/assertion-options')
      const options = await optionsResponse.json()
      const challenge = challengeCookie(getCookies(optionsResponse))
      const origin = new URL(optionsResponse.url).origin

      const assertionResponse = authenticator.createAssertionResponse(options.rpId, origin, options.challenge)

      await expect(
        $fetch('/api/auth/biometrics/verify', {
          method: 'POST',
          body: assertionResponse,
          headers: { cookie: challenge ?? '' },
        }),
      ).rejects.toMatchObject({ statusCode: 401 })
    })

    it('rejects a failed assertion (wrong challenge) as unauthorized', async () => {
      const { authenticator, rpId, registerResponse } = await registerBiometrics()
      const { credential_id: credentialId } = await registerResponse.json()

      const optionsResponse = await fetch('/api/auth/biometrics/assertion-options')
      const challenge = challengeCookie(getCookies(optionsResponse))
      const origin = new URL(optionsResponse.url).origin

      const assertionResponse = authenticator.createAssertionResponse(rpId, origin, 'wrong-challenge')

      await expect(
        $fetch('/api/auth/biometrics/verify', {
          method: 'POST',
          body: assertionResponse,
          headers: { cookie: challenge ?? '' },
        }),
      ).rejects.toMatchObject({ statusCode: 401 })

      const biometrics = await prisma.biometrics.findUnique({ where: { credential_id: credentialId } })
      expect(biometrics?.counter).toBe(0)
    })
  })
})
