import {
  webauthnChallengeCookieName,
  webauthnChallengeCookieOptions,
} from '#server/utils/cookies'
import { issueSession } from '#server/utils/issue-session'
import { prisma } from '#server/utils/prisma'
import { serializeUser } from '#server/utils/serialize-user'
import { verifyAssertion } from '#server/utils/webauthn'

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
      statusMessage: 'validation.invalid_payload',
      data: {
        errors: result.error.issues.map(issue => ({
          name: issue.path[0],
          message: issue.message,
        })),
      },
    })
  }

  const unauthorizedError = createError({
    statusCode: 401,
    statusMessage: 'biometrics.invalid_credentials',
  })

  const biometrics = await prisma.biometrics.findUnique({
    where: { credential_id: result.data.id },
    include: { user: { include: { storage_connection: true } } },
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
