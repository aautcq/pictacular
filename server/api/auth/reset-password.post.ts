import { issuePasswordResetEmail } from '#server/utils/issue-password-reset-email'
import { prisma } from '#server/utils/prisma'
import { resetPasswordSchema } from '#server/utils/validation/reset-password'

// Replaces the former AuthController#resetPassword
// (POST /auth/send_password_reset_email): always responds 204 whether or
// not the email exists or is verified, to prevent account enumeration;
// when eligible, issues a reset token and sends the password-reset email.
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const result = resetPasswordSchema.safeParse(body)

  if (!result.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'auth.invalid_payload',
    })
  }

  const { email } = result.data

  const user = await prisma.user.findUnique({ where: { email } })
  if (user?.is_verified)
    await issuePasswordResetEmail(event, email)

  setResponseStatus(event, 204)
})
