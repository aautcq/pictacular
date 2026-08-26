import process from 'node:process'
import jwt from 'jsonwebtoken'

export interface AccessToken {
  user: {
    id: number
    email: string
  }
  session: {
    id: number
  }
}

export interface RefreshToken {
  userId: number
  sessionId: number
}

export interface AwsCredentialsTokens {
  access_key_id: string
  secret_access_key: string
}

export const accessTokenTtl = 15 * 60 // In seconds (15 minutes)
export const refreshTokenTtl = 7 * 24 * 60 * 60 // In seconds (7 days)

// Plain RS256 JWT utility module (no DI container), ported from the former
// NestJS JwtService. Silent-refresh (reIssueAccessToken) is intentionally
// not ported here — it depends on the sessions/users server utils, which are
// ported in a later ticket.
export function createTokens(
  user: { id: number, email: string },
  session: { id: number },
) {
  const config = useRuntimeConfig()
  const accessToken = jwt.sign(
    {
      user: { id: user.id, email: user.email },
      session: { id: session.id },
    },
    config.jwt.privateKey,
    { expiresIn: accessTokenTtl, algorithm: 'RS256' },
  )

  const refreshToken = jwt.sign(
    { userId: user.id, sessionId: session.id },
    config.jwt.privateKey,
    { expiresIn: refreshTokenTtl, algorithm: 'RS256' },
  )

  return { accessToken, refreshToken }
}

export function verifyToken<T>(token: string): T | null {
  try {
    return jwt.verify(token, useRuntimeConfig().jwt.publicKey, {
      algorithms: ['RS256'],
    }) as T
  }
  catch {
    return null
  }
}

// Unlike createTokens/verifyToken (only ever called inside a live Nitro
// request, where the useRuntimeConfig() auto-import is available), this is
// also called directly by e2e specs (outside of Nitro) to sign fixture
// tokens for direct DB setup — so it reads the env var itself rather than
// relying on the auto-import.
export function encodeAwsCredentials(payload: AwsCredentialsTokens) {
  return jwt.sign(payload, process.env.NUXT_JWT_PRIVATE_KEY as string, {
    expiresIn: refreshTokenTtl,
    algorithm: 'RS256',
  })
}

export function decodeAwsCredentials(token: string) {
  return verifyToken<AwsCredentialsTokens>(token)
}
