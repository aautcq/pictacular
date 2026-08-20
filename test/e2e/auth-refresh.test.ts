import type { AccessToken } from '../../server/utils/jwt'
import { $fetch, fetch, setup } from '@nuxt/test-utils/e2e'
import jwt from 'jsonwebtoken'
import { afterAll, describe, expect, it } from 'vitest'
import { accessTokenCookieName, refreshTokenCookieName } from '../../server/utils/cookies'
import { compareToken } from '../../server/utils/crypto'
import { prisma } from '../../server/utils/prisma'

// Black-box HTTP tests for token refresh + protected-route enforcement
// (issue #31), exercised against real sessions produced by the login
// endpoint (issue #30): an expired access token with a still-valid refresh
// token is transparently re-issued, a valid non-expired access token is
// left untouched, a revoked session's refresh token is rejected, and a
// request with neither token is fully unauthenticated.
describe('token refresh + protected-route enforcement', async () => {
  await setup()

  const emailPrefix = `jane-${Date.now()}`
  const password = 'Str0ng!Pass'

  function uniqueEmail() {
    return `${emailPrefix}-${Math.random().toString(36).slice(2)}@example.com`
  }

  async function createLoggedInSession() {
    const email = uniqueEmail()
    await $fetch('/api/auth/users', {
      method: 'POST',
      body: {
        email,
        first_name: 'Jane',
        last_name: 'Doe',
        password,
        password_confirmation: password,
      },
    })

    const user = await prisma.user.findUniqueOrThrow({ where: { email } })
    await $fetch(`/api/auth/verify/${user.verification_token}`)

    const loginResponse = await fetch('/api/auth/sessions', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
      headers: { 'content-type': 'application/json' },
    })

    const cookies = getCookies(loginResponse)
    const accessToken = extractCookieValue(cookies, accessTokenCookieName)
    const refreshToken = extractCookieValue(cookies, refreshTokenCookieName)
    const session = await prisma.session.findFirstOrThrow({ where: { user_id: user.id, active: true } })

    return { email, user, session, accessToken, refreshToken }
  }

  function getCookies(response: Response) {
    return response.headers.getSetCookie()
  }

  function extractCookieValue(cookies: string[], name: string) {
    const cookie = cookies.find(c => c.startsWith(`${name}=`))
    if (!cookie)
      throw new Error(`Missing ${name} cookie`)

    return cookie.split(';')[0].slice(`${name}=`.length)
  }

  function signExpiredAccessToken(payload: AccessToken) {
    return jwt.sign(payload, process.env.JWT_PRIVATE_KEY as string, {
      expiresIn: -10,
      algorithm: 'RS256',
    })
  }

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { startsWith: emailPrefix } } })
  })

  it('transparently refreshes an expired access token given a valid refresh token, re-issuing both cookies', async () => {
    const { user, session, refreshToken } = await createLoggedInSession()
    const expiredAccessToken = signExpiredAccessToken({ user: { id: user.id, email: user.email }, session: { id: session.id } })

    const response = await fetch('/api/test/protected', {
      headers: {
        cookie: `${accessTokenCookieName}=${expiredAccessToken}; ${refreshTokenCookieName}=${refreshToken}`,
      },
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      user: { id: user.id, email: user.email },
      session: { id: session.id },
    })

    const cookies = getCookies(response)
    const newAccessToken = extractCookieValue(cookies, accessTokenCookieName)
    const newRefreshToken = extractCookieValue(cookies, refreshTokenCookieName)
    expect(newAccessToken).not.toBe(expiredAccessToken)

    const refreshedSession = await prisma.session.findUniqueOrThrow({ where: { id: session.id } })
    expect(compareToken(newRefreshToken, refreshedSession.refresh_token as string)).toBe(true)

    // The refreshed session accepts the newly-issued access token going forward.
    const followUp = await $fetch('/api/test/protected', {
      headers: { cookie: `${accessTokenCookieName}=${newAccessToken}` },
    })
    expect(followUp).toEqual({ user: { id: user.id, email: user.email }, session: { id: session.id } })
  })

  it('leaves a request with a valid, non-expired access token unaffected (no unnecessary refresh)', async () => {
    const { user, session, accessToken } = await createLoggedInSession()

    const response = await fetch('/api/test/protected', {
      headers: { cookie: `${accessTokenCookieName}=${accessToken}` },
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      user: { id: user.id, email: user.email },
      session: { id: session.id },
    })
    expect(getCookies(response)).toHaveLength(0)
  })

  it('rejects a stale, already-rotated-out refresh token even though it is still cryptographically valid (bcrypt-72-byte-truncation regression, issue #9)', async () => {
    const { user, session, refreshToken: staleRefreshToken } = await createLoggedInSession()
    const expiredAccessToken = signExpiredAccessToken({ user: { id: user.id, email: user.email }, session: { id: session.id } })

    // JWTs carry second-precision iat/exp: wait past the second boundary so
    // the rotated refresh token below is a genuinely distinct JWT rather
    // than an accidental byte-for-byte duplicate of the stale one.
    await new Promise(resolve => setTimeout(resolve, 1100))

    // Rotate the refresh token once via a legitimate silent refresh.
    const rotateResponse = await fetch('/api/test/protected', {
      headers: {
        cookie: `${accessTokenCookieName}=${expiredAccessToken}; ${refreshTokenCookieName}=${staleRefreshToken}`,
      },
    })
    expect(rotateResponse.status).toBe(200)

    // Replaying the now-superseded refresh token must be rejected: an RS256
    // refresh token for the same session shares its first 72 bytes with
    // every other token for that session (only iat/exp/signature differ,
    // all beyond byte 72), so a bcrypt-based compare would wrongly accept
    // it against the freshly-rotated hash.
    const replayResponse = await fetch('/api/test/protected', {
      headers: {
        cookie: `${accessTokenCookieName}=${expiredAccessToken}; ${refreshTokenCookieName}=${staleRefreshToken}`,
      },
    })

    expect(replayResponse.status).toBe(401)
  })

  it('rejects a refresh attempt against a revoked/logged-out session', async () => {
    const { user, session, refreshToken } = await createLoggedInSession()

    await prisma.session.update({ where: { id: session.id }, data: { active: false, refresh_token: null } })

    const expiredAccessToken = signExpiredAccessToken({ user: { id: user.id, email: user.email }, session: { id: session.id } })

    await expect(
      $fetch('/api/test/protected', {
        headers: {
          cookie: `${accessTokenCookieName}=${expiredAccessToken}; ${refreshTokenCookieName}=${refreshToken}`,
        },
      }),
    ).rejects.toMatchObject({ statusCode: 401 })
  })

  it('treats a request with neither a valid access nor refresh token as fully unauthenticated, clearing both cookies', async () => {
    const response = await fetch('/api/test/protected', {
      headers: { cookie: `${accessTokenCookieName}=not-a-real-token; ${refreshTokenCookieName}=not-a-real-token` },
    })

    expect(response.status).toBe(401)

    const cookies = getCookies(response)
    expect(cookies.some(cookie => cookie.startsWith(`${accessTokenCookieName}=;`))).toBe(true)
    expect(cookies.some(cookie => cookie.startsWith(`${refreshTokenCookieName}=;`))).toBe(true)
  })
})
