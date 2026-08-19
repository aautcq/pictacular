import { webauthnChallengeCookieName, webauthnChallengeCookieOptions } from '../../../utils/cookies'
import { prisma } from '../../../utils/prisma'
import { getRegistrationOptions } from '../../../utils/webauthn'

// Protected GET /api/auth/biometrics/registration-options: returns WebAuthn
// registration options for the authenticated user's account, replacing the
// former BiometricsController#registrationOptions. The challenge is stashed
// in a short-lived cookie so the following register-credential call can
// verify it without trusting the client to echo it back.
export default defineEventHandler(async (event) => {
  const { user } = requireAuth(event)

  const existingCredentials = await prisma.biometrics.findMany({
    where: { user_id: user.id },
    select: { credential_id: true },
  })

  const options = await getRegistrationOptions(
    event,
    user,
    existingCredentials.map(({ credential_id }) => credential_id),
  )

  setCookie(event, webauthnChallengeCookieName, options.challenge, webauthnChallengeCookieOptions)

  return options
})
