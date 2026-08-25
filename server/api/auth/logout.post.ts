import {
  accessTokenCookieName,
  accessTokenCookieOptions,
  refreshTokenCookieName,
  refreshTokenCookieOptions,
} from '#server/utils/cookies'
import { prisma } from '#server/utils/prisma'

// Replaces the former AuthController#logout (protected POST /auth/logout):
// deactivates the current session and clears both auth cookies.
export default defineEventHandler(async (event) => {
  const { session } = requireAuth(event)

  await prisma.session.update({
    where: { id: session.id },
    data: { active: false, refresh_token: null },
  })

  deleteCookie(event, accessTokenCookieName, accessTokenCookieOptions)
  deleteCookie(event, refreshTokenCookieName, refreshTokenCookieOptions)

  setResponseStatus(event, 204)
})
