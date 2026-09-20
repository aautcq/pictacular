import { fulfillPendingInvitations } from '#server/utils/fulfill-invitations'
import { prisma } from '#server/utils/prisma'

// Replaces the former AuthController#verify (GET /auth/verify/:token).
//
// Issue #52: verifying is this app's "finishing signup" moment (login
// stays blocked until then, so there's no earlier point at which an
// invited-but-unregistered person could meaningfully hold Album access) —
// so any pending Invitation(s) for this User's email are fulfilled right
// here (see fulfillPendingInvitations, also reused by issue #157's Google
// sign-up flow).
export default defineEventHandler(async (event) => {
  const token = getRouterParam(event, 'token')

  const user = token
    ? await prisma.user.findUnique({ where: { verification_token: token } })
    : null

  if (!user) {
    throw createError({
      statusCode: 401,
      statusMessage: 'auth.invalid_token',
    })
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { is_verified: true },
  })

  await fulfillPendingInvitations(user.id, user.email)

  setResponseStatus(event, 204)
})
