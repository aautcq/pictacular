import { webauthnChallengeCookieName, webauthnChallengeCookieOptions } from '../../../utils/cookies'
import { getAssertionOptions } from '../../../utils/webauthn'

// Unauthenticated GET /api/auth/biometrics/assertion-options: returns
// WebAuthn assertion options to start a biometric login from a logged-out
// state, replacing the former BiometricsController#assertionOptions.
export default defineEventHandler(async (event) => {
  const options = await getAssertionOptions(event)

  setCookie(event, webauthnChallengeCookieName, options.challenge, webauthnChallengeCookieOptions)

  return options
})
