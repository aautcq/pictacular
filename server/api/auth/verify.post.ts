import { issueEmailViaOutbox } from '../../utils/email-outbox'
import { getPreferredLang } from '../../utils/i18n/lang'
import { prisma } from '../../utils/prisma'
import { resendVerificationSchema } from '../../utils/validation/resend-verification'

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
      statusMessage: 'auth.invalid_payload',
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
