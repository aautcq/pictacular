import {
  accessTokenCookieName,
  accessTokenCookieOptions,
  refreshTokenCookieName,
  refreshTokenCookieOptions,
} from '../../utils/cookies'
import { comparePassword, hashToken } from '../../utils/crypto'
import { issuePasswordResetEmail } from '../../utils/issue-password-reset-email'
import { createTokens } from '../../utils/jwt'
import { prisma } from '../../utils/prisma'
import { serializeUser } from '../../utils/serialize-user'
import { loginSchema } from '../../utils/validation/login'

// Replaces the former AuthController#login (POST /auth/sessions): rejects
// invalid credentials or unverified accounts identically (no enumeration),
// locks out password attempts after 5 failures (auto-sending a
// password-reset email), and on success creates a session, revokes the
// user's other active sessions, updates last_sign_in_at, issues signed
// access/refresh JWT cookies, and returns a signed avatar URL when the user
// has AWS credentials and an avatar set.
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const result = loginSchema.safeParse(body)

  if (!result.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'auth.invalid_payload',
    })
  }

  const { email, password } = result.data

  const user = await prisma.user.findUnique({
    where: { email },
    include: { aws_credentials: true },
  })

  const invalidCredentialsError = createError({
    statusCode: 401,
    statusMessage: 'auth.invalid_credentials',
  })

  if (!user || !user.is_verified)
    throw invalidCredentialsError

  // Already locked out from a previous attempt: keep rejecting, but don't
  // resend the reset email — that's a one-time side effect of the failure
  // that trips the lock (below), not of every subsequent locked attempt,
  // otherwise an attacker who knows the victim's email could repeatedly
  // trigger reset emails (and invalidate the victim's own reset token) by
  // just re-submitting the login request.
  if (user.nb_incorrect_passwords >= 5)
    throw invalidCredentialsError

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

  const session = await prisma.session.create({
    data: {
      active: true,
      user_agent: getHeader(event, 'user-agent'),
      user: { connect: { id: user.id } },
    },
  })

  await prisma.session.updateMany({
    where: {
      user_id: user.id,
      active: true,
      NOT: { id: session.id },
    },
    data: { active: false, refresh_token: null },
  })

  const { last_sign_in_at } = await prisma.user.update({
    where: { id: user.id },
    data: { last_sign_in_at: new Date() },
  })

  const { accessToken, refreshToken } = createTokens(user, session)

  // See hashToken (server/utils/crypto.ts) for why refresh tokens use a
  // SHA-256 digest rather than bcrypt hashPassword.
  await prisma.session.update({
    where: { id: session.id },
    data: { refresh_token: hashToken(refreshToken) },
  })

  setCookie(event, accessTokenCookieName, accessToken, accessTokenCookieOptions)
  setCookie(event, refreshTokenCookieName, refreshToken, refreshTokenCookieOptions)

  setResponseStatus(event, 201)

  return serializeUser({
    id: user.id,
    email: user.email,
    first_name: user.first_name,
    last_name: user.last_name,
    avatar_url: user.avatar_url,
    aws_credentials: user.aws_credentials,
    created_at: user.created_at,
    last_sign_in_at,
  })
})
