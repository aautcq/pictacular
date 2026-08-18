import { accessTokenCookieName } from '../utils/cookies'
import type { AccessToken } from '../utils/jwt'

// Nitro middleware running on every request, mirroring the shape of the
// former AuthMiddleware (which wrote to response.locals): verifies the JWT
// from the access-token cookie and writes event.context.user/session.
//
// Silent refresh of an expired access token using the refresh-token cookie
// is intentionally out of scope here (separate ticket) — an expired/absent/
// invalid access token simply leaves the request unauthenticated.
export default defineEventHandler((event) => {
  const accessToken = getCookie(event, accessTokenCookieName)
  if (!accessToken)
    return

  const payload = verifyToken<AccessToken>(accessToken)
  if (!payload)
    return

  event.context.user = payload.user
  event.context.session = payload.session
})
