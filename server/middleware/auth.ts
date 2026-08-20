import type { AccessToken, RefreshToken } from '../utils/jwt'
import {
  accessTokenCookieName,
  accessTokenCookieOptions,
  refreshTokenCookieName,
  refreshTokenCookieOptions,
} from '../utils/cookies'
import { compareToken, hashToken } from '../utils/crypto'
import { createTokens, verifyToken } from '../utils/jwt'
import { prisma } from '../utils/prisma'

// Nitro middleware running on every request, mirroring the shape of the
// former AuthMiddleware (which wrote to response.locals): verifies the JWT
// from the access-token cookie and writes event.context.user/session.
//
// When the access token is missing/expired/invalid, it falls back to a
// silent refresh: a valid refresh-token cookie matching an active session
// re-issues and sets new access + refresh token cookies transparently
// before the request continues. When neither token is valid, the request
// is simply left unauthenticated (requireAuth clears both cookies and
// responds 401 for protected routes).
export default defineEventHandler(async (event) => {
  const accessToken = getCookie(event, accessTokenCookieName)

  if (accessToken) {
    const payload = verifyToken<AccessToken>(accessToken)
    if (payload) {
      event.context.user = payload.user
      event.context.session = payload.session
      return
    }
  }

  const refreshToken = getCookie(event, refreshTokenCookieName)
  if (!refreshToken)
    return

  const refreshPayload = verifyToken<RefreshToken>(refreshToken)
  if (!refreshPayload)
    return

  const session = await prisma.session.findUnique({
    where: { id: refreshPayload.sessionId },
    include: { user: true },
  })

  if (
    !session
    || !session.active
    || session.user_id !== refreshPayload.userId
    || !session.refresh_token
    || !compareToken(refreshToken, session.refresh_token)
  ) {
    return
  }

  const user = { id: session.user.id, email: session.user.email }
  const tokens = createTokens(user, session)

  // Guard the rotation with a conditional update tied to the hash that was
  // just verified: if a concurrent request (e.g. several requests racing
  // right after the access token expired) already rotated this session's
  // refresh token, this update matches zero rows and we bail out rather
  // than clobbering the winning rotation with our own stale one.
  const { count } = await prisma.session.updateMany({
    where: { id: session.id, refresh_token: session.refresh_token },
    data: { refresh_token: hashToken(tokens.refreshToken) },
  })

  if (count === 0)
    return

  setCookie(event, accessTokenCookieName, tokens.accessToken, accessTokenCookieOptions)
  setCookie(event, refreshTokenCookieName, tokens.refreshToken, refreshTokenCookieOptions)

  event.context.user = user
  event.context.session = { id: session.id }
})
