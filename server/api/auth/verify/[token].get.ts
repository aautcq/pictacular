import { prisma } from '../../../utils/prisma'

// Replaces the former AuthController#verify (GET /auth/verify/:token).
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

  setResponseStatus(event, 204)
})
