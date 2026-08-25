import {
  accessTokenCookieName,
  accessTokenCookieOptions,
  refreshTokenCookieName,
  refreshTokenCookieOptions,
} from '#server/utils/cookies'
import { prisma } from '#server/utils/prisma'

// Replaces the former UsersController#remove (protected DELETE /users/:id):
// deletes the authenticated user's own account. Sessions, biometrics, push
// subscriptions, AWS credentials, and reset tokens all cascade via the
// Prisma schema's onDelete: Cascade relations, then the auth cookies are
// cleared (a deleted account must not remain "logged in").
export default defineEventHandler(async (event) => {
  const { user } = requireAuth(event)

  await prisma.user.delete({ where: { id: user.id } })

  deleteCookie(event, accessTokenCookieName, accessTokenCookieOptions)
  deleteCookie(event, refreshTokenCookieName, refreshTokenCookieOptions)

  setResponseStatus(event, 204)
})
