import type { H3Event } from 'h3'
import { getPreferredLang } from './i18n/lang'
import { sendEmail } from './mailer'
import { generateResetPasswordToken } from './reset-password-token'

// Shared "issue a password-reset email" operation, reused by both the
// login lockout flow (5th incorrect password) and the self-service
// request-reset endpoint: creates a reset token synchronously (the
// durable, testable side effect) and fires off the email send without
// awaiting it, matching the former controllers where email delivery is not
// on the request's critical path/response.
export async function issuePasswordResetEmail(event: H3Event, email: string) {
  const token = await generateResetPasswordToken(email)
  const link = `${getRequestURL(event).origin}/reset-password/${token}`
  const lang = getPreferredLang(event)

  sendEmail({ email, link }, 'password-reset', lang)
    .catch(error => console.error('Failed to send password-reset email', error))
}
