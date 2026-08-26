import { issueEmailViaOutbox } from '#server/utils/email-outbox'
import { getPreferredLang } from '#server/utils/i18n/lang'
import { prisma } from '#server/utils/prisma'

// Replaces the former AuthController#sendVerificationEmail
// (POST /auth/send_verification_email): always responds 204 whether or
// not the email exists or is already verified, to prevent account
// enumeration; when eligible, re-sends the verification email using the
// user's existing (unchanged) verification_token.
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const result = resendVerificationSchema.safeParse(body)

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
  if (user && !user.is_verified) {
    const link = `${getRequestURL(event).origin}/verification/${user.verification_token}`
    const lang = getPreferredLang(event)

    // Routed through the durable outbox (issue #92/#95) instead of a bare
    // sendEmail call: awaiting here only waits for the pending row write
    // (so the send outcome is queryable as soon as this responds), not
    // for the email send itself, which stays off this endpoint's critical
    // path/response.
    await issueEmailViaOutbox('verification', user.email, link, lang)
  }

  setResponseStatus(event, 204)
})
