import type { H3Event } from 'h3'
import { issueEmailViaOutbox } from './email-outbox'
import { getPreferredLang } from './i18n/lang'
import { generateResetPasswordToken } from './reset-password-token'

// Shared "issue a password-reset email" operation, reused by both the
// login lockout flow (5th incorrect password) and the self-service
// request-reset endpoint: creates a reset token synchronously (the
// durable, testable side effect), then routes the email through the
// durable outbox (issue #92/#94) instead of a bare sendEmail call —
// awaiting only the pending row write (so the send outcome is queryable
// as soon as the caller responds), not the email send itself, which stays
// off the request's critical path/response, matching the former
// controllers.
export async function issuePasswordResetEmail(event: H3Event, email: string) {
  const token = await generateResetPasswordToken(email)
  const link = `${getRequestURL(event).origin}/reset-password/${token}`
  const lang = getPreferredLang(event)

  await issueEmailViaOutbox('password-reset', email, link, lang)
}
