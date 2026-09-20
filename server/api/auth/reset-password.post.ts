import { issuePasswordResetEmail } from '#server/utils/issue-password-reset-email'
import { prisma } from '#server/utils/prisma'

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
      statusMessage: 'validation.invalid_payload',
      data: {
        errors: result.error.issues.map(issue => ({
          name: issue.path[0],
          message: issue.message,
        })),
      },
    })
  }

  const { email } = result.data

  const user = await prisma.user.findUnique({ where: { email } })
  // Issue #157: a Google-only (null-password) User has nothing to reset —
  // silently no-op here (same as the unverified branch above) rather than
  // sending a reset email for a password that doesn't exist, keeping this
  // endpoint's enumeration-safe 204-either-way contract intact.
  if (user?.is_verified && user.password)
    await issuePasswordResetEmail(event, email)

  setResponseStatus(event, 204)
})
