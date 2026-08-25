import { hashPassword } from '#server/utils/crypto'
import { prisma } from '#server/utils/prisma'
import { setPasswordSchema } from '#server/utils/validation/set-password'

// Replaces the former AuthController#setPassword
// (POST /auth/reset_password/:token): given a valid, non-expired, unused
// reset token, updates the password, resets the failed-attempt counter,
// and invalidates the token. Expired, already-used, or unknown tokens are
// rejected with a namespaced error code, matching the verify endpoint's
// auth.invalid_token convention.
export default defineEventHandler(async (event) => {
  const token = getRouterParam(event, 'token')

  const body = await readBody(event)
  const result = setPasswordSchema.safeParse(body)

  if (!result.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'auth.invalid_payload',
    })
  }

  // Atomically claim the token: this conditional update only matches (and
  // flips `expired`) while the token is still valid, so a concurrent
  // request racing with the same token can't slip through a check-then-act
  // window and reuse it — a zero-row result means it was already used,
  // expired, or is unknown.
  const { count } = token
    ? await prisma.resetPasswordToken.updateMany({
        where: { token, expired: false, expiresAt: { gte: new Date() } },
        data: { expired: true },
      })
    : { count: 0 }

  if (count === 0) {
    throw createError({
      statusCode: 401,
      statusMessage: 'auth.invalid_token',
    })
  }

  const resetPasswordToken = await prisma.resetPasswordToken.findUniqueOrThrow({ where: { token } })
  const { password } = result.data

  await prisma.user.update({
    where: { id: resetPasswordToken.user_id },
    data: { password: hashPassword(password), nb_incorrect_passwords: 0 },
  })

  setResponseStatus(event, 204)
})
