import { Prisma } from '#server/generated/prisma/client'
import { oauthStateCookieName, oauthStateCookieOptions } from '#server/utils/cookies'
import { fulfillPendingInvitations } from '#server/utils/fulfill-invitations'
import { exchangeGoogleCode, fetchGoogleUserinfo, splitGoogleName } from '#server/utils/google-oauth'
import { issueSession } from '#server/utils/issue-session'
import { prisma } from '#server/utils/prisma'
import { generateUniqueVerificationToken } from '#server/utils/verification-token'

const googleProvider = 'google'

// Issue #157: the callback leg of the hand-rolled Google OAuth 2.0
// authorization-code flow. This is a full-page redirect target (Google
// itself redirects the browser here), never a fetch call, so both success
// and failure resolve via `sendRedirect` back to a client page rather than
// a JSON response — the client reads `oauth_error` off the URL and
// translates it exactly like any other namespaced error code (see
// useErrorMessage), and reads nothing on success since the cookies set
// below already carry the new Session.
//
// Applies the account-linking policy from ADR-0007: an existing
// OAuthAccount signs straight in; otherwise a matching User (by email) is
// linked (and verified, if it wasn't already); otherwise a brand-new,
// already-verified User is created (with a same-effect-as-registration
// pending-Invitation fulfillment) before linking. Session
// creation/cookie issuance is identical to password login (issueSession).
export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const code = typeof query.code === 'string' ? query.code : undefined
  const state = typeof query.state === 'string' ? query.state : undefined

  const expectedState = getCookie(event, oauthStateCookieName)
  deleteCookie(event, oauthStateCookieName, oauthStateCookieOptions)

  const oauthFailedRedirect = '/login?oauth_error=auth.oauth_failed'

  // Google sets `error` (e.g. `access_denied`) instead of `code` when the
  // person cancels/denies consent on its own consent screen. A missing/
  // mismatched `state` means either a forged callback or a stale/expired
  // cookie (e.g. the flow was started, then abandoned for 5+ minutes) —
  // both are rejected identically, before ever exchanging `code`.
  if (query.error || !code || !state || !expectedState || state !== expectedState)
    return sendRedirect(event, oauthFailedRedirect)

  const redirectUri = `${getRequestURL(event).origin}/api/auth/google/callback`

  let userinfo
  try {
    const accessToken = await exchangeGoogleCode(code, redirectUri)
    userinfo = await fetchGoogleUserinfo(accessToken)
  }
  catch {
    return sendRedirect(event, oauthFailedRedirect)
  }

  // Google's own verified-email claim is this feature's entire trust
  // anchor for auto-linking/creating a User (ADR-0007) — an unverified
  // Google email can't be trusted to prove ownership of that address.
  if (!userinfo.email_verified)
    return sendRedirect(event, oauthFailedRedirect)

  const existingAccount = await prisma.oAuthAccount.findUnique({
    where: { provider_provider_user_id: { provider: googleProvider, provider_user_id: userinfo.sub } },
    include: { user: true },
  })

  let user = existingAccount?.user

  try {
    if (!user) {
      const existingUser = await prisma.user.findUnique({ where: { email: userinfo.email } })

      if (existingUser) {
        user = existingUser.is_verified
          ? existingUser
          // Google has just proven ownership of this email — exactly what
          // Pictacular's own Verification exists to establish — so an
          // unverified match is linked *and* flipped to verified.
          : await prisma.user.update({ where: { id: existingUser.id }, data: { is_verified: true } })
      }
      else {
        const fallbackName = userinfo.name || userinfo.email.split('@')[0] || userinfo.email
        const { first_name, last_name } = splitGoogleName(fallbackName)

        user = await prisma.user.create({
          data: {
            email: userinfo.email,
            first_name,
            last_name,
            password: null,
            // Google's verified-email claim substitutes for Pictacular's own
            // Verification flow — no verification email is sent.
            is_verified: true,
            verification_token: await generateUniqueVerificationToken(),
          },
        })

        await fulfillPendingInvitations(user.id, user.email)
      }

      await prisma.oAuthAccount.create({
        data: {
          provider: googleProvider,
          provider_user_id: userinfo.sub,
          email: userinfo.email,
          user: { connect: { id: user.id } },
        },
      })
    }
  }
  catch (error) {
    // The upfront findUnique checks above are TOCTOU-vulnerable to a
    // concurrent callback for the same email/provider_user_id (e.g. a
    // double-click on "Continue with Google", or two tabs finishing the
    // same flow) racing this one to create the User/OAuthAccount row —
    // mirrors the same P2002 fallback users.post.ts relies on for its own
    // concurrent-registration race. Rather than crash, send the person
    // back through the flow: the row the other request created now
    // resolves cleanly on retry.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
      return sendRedirect(event, oauthFailedRedirect)

    throw error
  }

  await issueSession(event, user)

  return sendRedirect(event, '/')
})
