import type { H3Event } from 'h3'
import {
  accessTokenCookieName,
  accessTokenCookieOptions,
  refreshTokenCookieName,
  refreshTokenCookieOptions,
} from './cookies'

// Replaces the former AuthGuard: asserts that the auth middleware wrote a
// user/session onto event.context, throwing a 401 (and clearing the auth
// cookies) when it did not.
export function requireAuth(event: H3Event) {
  const { user, session } = event.context

  if (!user || !session) {
    deleteCookie(event, accessTokenCookieName, accessTokenCookieOptions)
    deleteCookie(event, refreshTokenCookieName, refreshTokenCookieOptions)

    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
    })
  }

  return { user, session }
}
