import { oauthStateCookieName, oauthStateCookieOptions } from '#server/utils/cookies'
import { generateRandomString } from '#server/utils/crypto'
import { buildGoogleAuthorizationUrl } from '#server/utils/google-oauth'

// Issue #157: starts the hand-rolled Google OAuth 2.0 authorization-code
// flow. Full-page redirect (never a fetch call — Google's own consent
// screen requires a real top-level browser navigation), so the "Continue
// with Google" button on login.vue/register.vue links here directly
// rather than going through useCurrentUser. Stashes a random CSRF `state`
// value in a short-lived cookie that GET /api/auth/google/callback checks
// against the `state` Google echoes back.
export default defineEventHandler(async (event) => {
  const state = generateRandomString(32)
  setCookie(event, oauthStateCookieName, state, oauthStateCookieOptions)

  const redirectUri = `${getRequestURL(event).origin}/api/auth/google/callback`

  await sendRedirect(event, buildGoogleAuthorizationUrl(state, redirectUri))
})
