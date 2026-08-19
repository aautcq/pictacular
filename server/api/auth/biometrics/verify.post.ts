import {
  accessTokenCookieName,
  accessTokenCookieOptions,
  refreshTokenCookieName,
  refreshTokenCookieOptions,
  webauthnChallengeCookieName,
  webauthnChallengeCookieOptions,
} from '../../../utils/cookies'
import { hashToken } from '../../../utils/crypto'
import { createTokens } from '../../../utils/jwt'
import { prisma } from '../../../utils/prisma'
import { generateSecureAvatarUrl } from '../../../utils/storage'
import { verifyAssertionSchema } from '../../../utils/validation/biometrics'
import { verifyAssertion } from '../../../utils/webauthn'

// Unauthenticated POST /api/auth/biometrics/verify: on a successful
// assertion, produces the exact same side effects as password login
// (server/api/auth/sessions.post.ts) — new session created, other sessions
// revoked, access/refresh cookies set, last_sign_in_at updated. An unknown
// credential ID or a failed assertion is rejected as unauthorized,
// replacing the former BiometricsController#verify.
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const result = verifyAssertionSchema.safeParse(body)

  if (!result.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'biometrics.invalid_payload',
    })
  }

  const unauthorizedError = createError({
    statusCode: 401,
    statusMessage: 'biometrics.invalid_credentials',
  })

  const biometrics = await prisma.biometrics.findUnique({
    where: { credential_id: result.data.id },
    include: { user: { include: { aws_credentials: true } } },
  })

  if (!biometrics)
    throw unauthorizedError

  const challenge = getCookie(event, webauthnChallengeCookieName)
  deleteCookie(event, webauthnChallengeCookieName, webauthnChallengeCookieOptions)

  if (!challenge)
    throw unauthorizedError

  const assertion = await verifyAssertion(event, result.data, challenge, biometrics)
  if (!assertion)
    throw unauthorizedError

  const { user } = biometrics

  await prisma.biometrics.update({
    where: { id: biometrics.id },
    data: { counter: assertion.newCounter },
  })

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

  let avatarUrl = null
  if (user.avatar_url && user.aws_credentials)
    avatarUrl = await generateSecureAvatarUrl(user.aws_credentials, user.avatar_url)

  setCookie(event, accessTokenCookieName, accessToken, accessTokenCookieOptions)
  setCookie(event, refreshTokenCookieName, refreshToken, refreshTokenCookieOptions)

  setResponseStatus(event, 201)

  return {
    id: user.id,
    email: user.email,
    first_name: user.first_name,
    last_name: user.last_name,
    has_aws_credentials: !!user.aws_credentials?.id,
    avatar_url: avatarUrl,
    created_at: user.created_at,
    last_sign_in_at,
  }
})
