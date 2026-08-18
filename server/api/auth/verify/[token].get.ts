import { prisma } from '../../../utils/prisma'

// Replaces the former AuthController#verify (GET /auth/verify/:token):
// verification_token isn't a unique column, so this looks up the first
// matching user rather than using a Prisma unique lookup.
export default defineEventHandler(async (event) => {
  const token = getRouterParam(event, 'token')

  const user = token
    ? await prisma.user.findFirst({ where: { verification_token: token } })
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

  setResponseStatus(event, 204)
})
