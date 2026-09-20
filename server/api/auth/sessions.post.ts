import { burnPasswordCompareTime, comparePassword } from '#server/utils/crypto'
import { issuePasswordResetEmail } from '#server/utils/issue-password-reset-email'
import { issueSession } from '#server/utils/issue-session'
import { prisma } from '#server/utils/prisma'
import { serializeUser } from '#server/utils/serialize-user'

// Replaces the former AuthController#login (POST /auth/sessions): rejects
// invalid credentials or unverified accounts identically (no enumeration
// in the response itself, and no enumeration by timing either — see
// burnPasswordCompareTime), locks out password attempts after 5 failures
// (auto-sending a password-reset email), and on success creates a
// session, revokes the user's other active sessions, updates
// last_sign_in_at, issues signed access/refresh JWT cookies, and returns
// a signed avatar URL when the user has AWS credentials and an avatar
// set.
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const result = loginSchema.safeParse(body)

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

  const { email, password } = result.data

  const user = await prisma.user.findUnique({
    where: { email },
    include: { storage_connection: true },
  })

  const invalidCredentialsError = createError({
    statusCode: 401,
    statusMessage: 'auth.invalid_credentials',
  })

  if (!user || !user.is_verified) {
    // No real password hash to compare against on this branch — burn a
    // comparable amount of time anyway so this rejection isn't
    // distinguishable (by latency) from a wrong-password rejection below,
    // which would otherwise leak whether the email is registered.
    burnPasswordCompareTime()
    throw invalidCredentialsError
  }

  // Issue #157: a User who signed up exclusively via an OAuth Account
  // (e.g. Google) has no password to compare against at all. This is a
  // distinct rejection from invalid_credentials on purpose — that code
  // implies a password exists to guess, which would be misleading UX for
  // an account that simply never had one; the response already reveals
  // this account exists, but so does redirecting a would-be Google user
  // through a "wrong password" message that can never succeed.
  if (!user.password) {
    throw createError({
      statusCode: 401,
      statusMessage: 'auth.password_not_set',
    })
  }

  // Already locked out from a previous attempt: keep rejecting, but don't
  // resend the reset email — that's a one-time side effect of the failure
  // that trips the lock (below), not of every subsequent locked attempt,
  // otherwise an attacker who knows the victim's email could repeatedly
  // trigger reset emails (and invalidate the victim's own reset token) by
  // just re-submitting the login request. Still burn the same dummy
  // compare time as the unknown-email branch above, though: without it,
  // this rejection would return measurably faster than a live
  // comparePassword call below, reopening the exact timing oracle this
  // file otherwise closes (a locked-out account is necessarily a real,
  // verified one).
  if (user.nb_incorrect_passwords >= 5) {
    burnPasswordCompareTime()
    throw invalidCredentialsError
  }

  const isPasswordValid = comparePassword(password, user.password)
  if (!isPasswordValid) {
    const nbIncorrectPasswords = user.nb_incorrect_passwords + 1
    await prisma.user.update({
      where: { id: user.id },
      data: { nb_incorrect_passwords: nbIncorrectPasswords },
    })

    // This 5th failure is the one that locks the account: send the
    // password-reset email immediately.
    if (nbIncorrectPasswords >= 5)
      await issuePasswordResetEmail(event, email)

    throw invalidCredentialsError
  }

  if (user.nb_incorrect_passwords > 0) {
    await prisma.user.update({
      where: { id: user.id },
      data: { nb_incorrect_passwords: 0 },
    })
  }

  const last_sign_in_at = await issueSession(event, user)

  setResponseStatus(event, 201)

  return serializeUser({
    id: user.id,
    email: user.email,
    first_name: user.first_name,
    last_name: user.last_name,
    avatar_url: user.avatar_url,
    storage_connection: user.storage_connection,
    created_at: user.created_at,
    last_sign_in_at,
  })
})
