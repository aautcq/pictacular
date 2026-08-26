import { webauthnChallengeCookieName, webauthnChallengeCookieOptions } from '#server/utils/cookies'
import { prisma } from '#server/utils/prisma'
import { verifyRegistration } from '#server/utils/webauthn'

// Protected POST /api/auth/biometrics: stores a new biometric credential for
// the authenticated user, replacing the former BiometricsController#create.
export default defineEventHandler(async (event) => {
  const { user } = requireAuth(event)

  const body = await readBody(event)
  const result = registerCredentialSchema.safeParse(body)

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

  const challenge = getCookie(event, webauthnChallengeCookieName)
  if (!challenge) {
    throw createError({
      statusCode: 400,
      statusMessage: 'biometrics.missing_challenge',
    })
  }

  const registration = await verifyRegistration(event, result.data, challenge)
  deleteCookie(event, webauthnChallengeCookieName, webauthnChallengeCookieOptions)

  if (!registration) {
    throw createError({
      statusCode: 400,
      statusMessage: 'biometrics.registration_failed',
    })
  }

  await prisma.biometrics.create({
    data: {
      credential_id: registration.credentialId,
      public_key: registration.publicKey,
      counter: registration.counter,
      user: { connect: { id: user.id } },
    },
  })

  setResponseStatus(event, 201)

  return { credential_id: registration.credentialId }
})
