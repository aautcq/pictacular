import { $fetch, setup } from '@nuxt/test-utils/e2e'
import jwt from 'jsonwebtoken'
import { describe, expect, it } from 'vitest'
import { accessTokenCookieName } from '../../server/utils/cookies'
import type { AccessToken } from '../../server/utils/jwt'

// Black-box HTTP tests for the auth-context plumbing (JWT verification,
// server/middleware/auth.ts writing event.context, requireAuth guarding a
// protected route) — see docs/adr/0001-nuxt-server-replaces-nestjs-api.md.
describe('auth context', async () => {
  await setup()

  function signAccessToken(payload: AccessToken) {
    return jwt.sign(payload, process.env.JWT_PRIVATE_KEY as string, {
      expiresIn: '15m',
      algorithm: 'RS256',
    })
  }

  it('rejects an unauthenticated request with 401', async () => {
    await expect($fetch('/api/test/protected')).rejects.toMatchObject({
      statusCode: 401,
    })
  })

  it('rejects a request with an invalid access-token cookie with 401', async () => {
    await expect(
      $fetch('/api/test/protected', {
        headers: { cookie: `${accessTokenCookieName}=not-a-real-token` },
      }),
    ).rejects.toMatchObject({ statusCode: 401 })
  })

  it('accepts a request with a validly-signed access-token cookie', async () => {
    const accessToken = signAccessToken({
      user: { id: 1, email: 'jane@example.com' },
      session: { id: 42 },
    })

    const response = await $fetch('/api/test/protected', {
      headers: { cookie: `${accessTokenCookieName}=${accessToken}` },
    })

    expect(response).toEqual({
      user: { id: 1, email: 'jane@example.com' },
      session: { id: 42 },
    })
  })
})
