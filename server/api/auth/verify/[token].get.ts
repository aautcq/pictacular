import { prisma } from '#server/utils/prisma'

// Replaces the former AuthController#verify (GET /auth/verify/:token).
//
// Issue #52: verifying is this app's "finishing signup" moment (login
// stays blocked until then, so there's no earlier point at which an
// invited-but-unregistered person could meaningfully hold Album access) —
// so any pending Invitation(s) for this User's email become Collaborator
// access right here, then get cleared so a later re-invite starts fresh
// rather than resurrecting a stale row.
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

  const invitations = await prisma.invitation.findMany({ where: { email: user.email } })

  for (const invitation of invitations) {
    await prisma.album.update({
      where: { id: invitation.album_id },
      data: { users: { connect: { id: user.id } } },
    })
  }

  if (invitations.length) {
    await prisma.invitation.deleteMany({ where: { email: user.email } })
  }

  setResponseStatus(event, 204)
})
