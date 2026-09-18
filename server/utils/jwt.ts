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

// `verifyToken` used to only ever be called inside a live Nitro request,
// where the useRuntimeConfig() auto-import is available — issue #145's
// scan task first broke that assumption (server/tasks/archived-photos/scan.ts
// invokes `run()` directly, with no HTTP entry point at all, following the
// exact "invoke run() directly, no request context" precedent
// server/tasks/email-outbox/process.ts's own test already established).
// `typeof useRuntimeConfig` (rather than calling it unconditionally) is
// what safely detects that missing auto-import without throwing —
// server/utils/web-push.ts's own JWT verification uses the same
// accommodation for the same reason.
export function verifyToken<T>(token: string): T | null {
  try {
    const publicKey = typeof useRuntimeConfig === 'function'
      ? useRuntimeConfig().jwt.publicKey
      : process.env.NUXT_JWT_PUBLIC_KEY as string

    return jwt.verify(token, publicKey, {
      algorithms: ['RS256'],
    }) as T
  }
  catch {
    return null
  }
}

export interface StorageConnectionLaunch {
  user_id: number
  external_id: string
  bucket: string
  role_arn: string
  // Which onboarding mode generated this pending connection (issue #152):
  // the confirm step (server/utils/storage.ts#confirmStorageConnection)
  // needs this to know whether a HeadBucket failure means "stack hasn't
  // finished creating the bucket yet" (create) vs. "named an
  // unreachable/nonexistent bucket" (connect), and whether the bucket's
  // region can be assumed to be the stack's own launch region at all
  // (never true for connect, since that bucket already existed).
  mode: 'create' | 'connect'
}

export const storageConnectionLaunchTtl = 60 * 60 // In seconds (1 hour) — long enough to launch the CloudFormation stack and let it finish creating, without leaving a stale pending connection indefinitely signable.

// Signs the short-lived "pending Storage Connection" token issued by POST
// /api/storage-connections/launch and later redeemed by POST
// /api/storage-connections (issue #150): rather than the User pasting any
// of the bucket name/Role ARN/External ID back by hand, Pictacular itself
// generates them, hands them to CloudFormation as pre-filled Launch Stack
// URL parameters, and keeps its own record of what it expects to find via
// this signed token. Also called directly by storage-connections.test.ts
// to craft pending tokens for confirm-step edge cases (a role-not-
// assumable/wrong-User token an unmodified launch call can't easily
// produce), same "outside a live Nitro request" situation the old
// key-pair flow's encodeAwsCredentials handled — hence the same
// useRuntimeConfig()-or-env-var fallback.
export function encodeStorageConnectionLaunch(payload: StorageConnectionLaunch) {
  const privateKey = typeof useRuntimeConfig === 'function'
    ? useRuntimeConfig().jwt.privateKey
    : process.env.NUXT_JWT_PRIVATE_KEY as string

  return jwt.sign(payload, privateKey, {
    expiresIn: storageConnectionLaunchTtl,
    algorithm: 'RS256',
  })
}

export function decodeStorageConnectionLaunch(token: string) {
  return verifyToken<StorageConnectionLaunch>(token)
}
