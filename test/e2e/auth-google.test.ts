import type { FakeGoogleOAuthServer } from './fake-google-oauth-server'
import process from 'node:process'
import { $fetch, fetch, setup } from '@nuxt/test-utils/e2e'
import { afterAll, describe, expect, it } from 'vitest'
import { accessTokenCookieName, oauthStateCookieName, refreshTokenCookieName } from '../../server/utils/cookies'
import { hashPassword } from '../../server/utils/crypto'
import { prisma } from '../../server/utils/prisma'
import { startFakeGoogleOAuthServer } from './fake-google-oauth-server'

// Black-box HTTP tests for "Continue with Google" sign-up/sign-in (issue
// #157/ADR-0007): GET /api/auth/google starts the hand-rolled
// authorization-code flow (state cookie + redirect), and GET
// /api/auth/google/callback completes it against an in-process fake
// Google double (test/e2e/fake-google-oauth-server.ts, pointed to via
// GOOGLE_OAUTH_ENDPOINT) — never real Google/network access. Covers the
// account-linking policy (new sign-up, link-to-verified, link-and-verify),
// the name-fallback edge case, pending-Invitation fulfillment on sign-up,
// null-password rejection on the password login/reset endpoints, and that
// a Google sign-in revokes other active Sessions exactly like password
// login.
describe('google oauth sign-in/sign-up', async () => {
  const fakeGoogle: FakeGoogleOAuthServer = await startFakeGoogleOAuthServer()
  process.env.GOOGLE_OAUTH_ENDPOINT = fakeGoogle.url
  process.env.NUXT_GOOGLE_CLIENT_ID = 'test-client-id'
  process.env.NUXT_GOOGLE_CLIENT_SECRET = 'test-client-secret'

  await setup()

  const emailPrefix = `google-oauth-${Date.now()}`

  function uniqueEmail(label: string) {
    return `${emailPrefix}-${label}-${Math.random().toString(36).slice(2)}@example.com`
  }

  function uniqueSub(label: string) {
    return `google-sub-${label}-${Math.random().toString(36).slice(2)}`
  }

  function getCookies(response: Response) {
    return response.headers.getSetCookie()
  }

  function stateCookie(cookies: string[]) {
    const cookie = cookies.find(cookie => cookie.startsWith(`${oauthStateCookieName}=`))
    return cookie ? cookie.split(';')[0] : undefined
  }

  // Starts the flow (GET /api/auth/google) to obtain a real state cookie,
  // seeds the fake Google double with the identity a subsequent callback
  // should resolve to, then calls the callback directly with that state +
  // a matching code — standing in for the browser's redirect back from
  // Google's real consent screen.
  async function completeGoogleSignIn(identity: { sub: string, email: string, email_verified: boolean, name?: string }) {
    const startResponse = await fetch('/api/auth/google', { redirect: 'manual' })
    const cookieHeader = stateCookie(getCookies(startResponse))
    const state = cookieHeader!.split('=')[1]

    const code = `code-${Math.random().toString(36).slice(2)}`
    fakeGoogle.seedIdentity(code, identity)

    return fetch(`/api/auth/google/callback?code=${code}&state=${state}`, {
      redirect: 'manual',
      headers: { cookie: cookieHeader! },
    })
  }

  afterAll(async () => {
    await prisma.invitation.deleteMany({ where: { email: { startsWith: emailPrefix } } })
    await prisma.album.deleteMany({ where: { admin: { email: { startsWith: emailPrefix } } } })
    await prisma.user.deleteMany({ where: { email: { startsWith: emailPrefix } } })
    await fakeGoogle.close()
  })

  describe('gET /api/auth/google', () => {
    it('redirects to a Google authorization URL and stashes a state cookie', async () => {
      const response = await fetch('/api/auth/google', { redirect: 'manual' })

      expect(response.status).toBe(302)
      const location = response.headers.get('location')!
      expect(location).toContain('/o/oauth2/v2/auth')
      expect(location).toContain('client_id=test-client-id')
      expect(stateCookie(getCookies(response))).toBeTruthy()
    })
  })

  describe('gET /api/auth/google/callback', () => {
    it('creates a brand-new, already-verified User on a fresh sign-up, issuing a Session', async () => {
      const email = uniqueEmail('fresh-signup')
      const response = await completeGoogleSignIn({
        sub: uniqueSub('fresh-signup'),
        email,
        email_verified: true,
        name: 'Ada Lovelace',
      })

      expect(response.status).toBe(302)
      expect(response.headers.get('location')).toBe('/')

      const user = await prisma.user.findUniqueOrThrow({ where: { email } })
      expect(user.is_verified).toBe(true)
      expect(user.password).toBeNull()
      expect(user.first_name).toBe('Ada')
      expect(user.last_name).toBe('Lovelace')

      const oauthAccount = await prisma.oAuthAccount.findFirst({ where: { user_id: user.id, provider: 'google' } })
      expect(oauthAccount?.email).toBe(email)

      const cookies = getCookies(response)
      expect(cookies.some(cookie => cookie.startsWith(`${accessTokenCookieName}=`))).toBe(true)
      expect(cookies.some(cookie => cookie.startsWith(`${refreshTokenCookieName}=`))).toBe(true)
      expect(user.last_sign_in_at).toBeTruthy()
    })

    it('falls back to the whole name as first_name (empty last_name) when it has no space', async () => {
      const email = uniqueEmail('no-space-name')
      await completeGoogleSignIn({
        sub: uniqueSub('no-space-name'),
        email,
        email_verified: true,
        name: 'Prince',
      })

      const user = await prisma.user.findUniqueOrThrow({ where: { email } })
      expect(user.first_name).toBe('Prince')
      expect(user.last_name).toBe('')
    })

    it('links to and signs in as an existing verified User with a matching email, without creating a duplicate', async () => {
      const email = uniqueEmail('existing-verified')
      await $fetch('/api/auth/users', {
        method: 'POST',
        body: {
          email,
          first_name: 'John',
          last_name: 'Doe',
          password: 'Str0ng!Pass',
          password_confirmation: 'Str0ng!Pass',
        },
      })
      const existingUser = await prisma.user.findUniqueOrThrow({ where: { email } })
      await $fetch(`/api/auth/verify/${existingUser.verification_token}`)

      const response = await completeGoogleSignIn({
        sub: uniqueSub('existing-verified'),
        email,
        email_verified: true,
        name: 'John Doe',
      })

      expect(response.status).toBe(302)
      expect(response.headers.get('location')).toBe('/')

      const users = await prisma.user.findMany({ where: { email } })
      expect(users).toHaveLength(1)

      const oauthAccount = await prisma.oAuthAccount.findFirst({ where: { user_id: existingUser.id, provider: 'google' } })
      expect(oauthAccount).toBeTruthy()
    })

    it('links to and verifies an existing unverified User with a matching email', async () => {
      const email = uniqueEmail('existing-unverified')
      await $fetch('/api/auth/users', {
        method: 'POST',
        body: {
          email,
          first_name: 'Jane',
          last_name: 'Doe',
          password: 'Str0ng!Pass',
          password_confirmation: 'Str0ng!Pass',
        },
      })
      const existingUser = await prisma.user.findUniqueOrThrow({ where: { email } })
      expect(existingUser.is_verified).toBe(false)

      await completeGoogleSignIn({
        sub: uniqueSub('existing-unverified'),
        email,
        email_verified: true,
        name: 'Jane Doe',
      })

      const updatedUser = await prisma.user.findUniqueOrThrow({ where: { email } })
      expect(updatedUser.is_verified).toBe(true)
    })

    it('fulfills a pending Invitation for a brand-new Google sign-up', async () => {
      const adminEmail = uniqueEmail('invite-admin')
      const admin = await prisma.user.create({
        data: {
          email: adminEmail,
          first_name: 'Admin',
          last_name: 'User',
          password: hashPassword('Str0ng!Pass'),
          is_verified: true,
          verification_token: `verif-${Math.random().toString(36).slice(2)}`,
        },
      })
      const album = await prisma.album.create({
        data: { title: 'Shared Album', admin: { connect: { id: admin.id } } },
      })
      const invitedEmail = uniqueEmail('invitee')
      await prisma.invitation.create({
        data: { email: invitedEmail, album: { connect: { id: album.id } }, token: `invite-${Math.random().toString(36).slice(2)}` },
      })

      await completeGoogleSignIn({
        sub: uniqueSub('invitee'),
        email: invitedEmail,
        email_verified: true,
        name: 'Invited Person',
      })

      const invitedUser = await prisma.user.findUniqueOrThrow({ where: { email: invitedEmail } })
      const membership = await prisma.album.findFirst({ where: { id: album.id, users: { some: { id: invitedUser.id } } } })
      expect(membership).toBeTruthy()

      const remainingInvitations = await prisma.invitation.findMany({ where: { email: invitedEmail } })
      expect(remainingInvitations).toHaveLength(0)
    })

    it('revokes the User\'s other active Sessions, exactly like password login', async () => {
      const email = uniqueEmail('revoke-sessions')
      const sub = uniqueSub('revoke-sessions')

      await completeGoogleSignIn({ sub, email, email_verified: true, name: 'First Sign In' })
      const user = await prisma.user.findUniqueOrThrow({ where: { email } })

      const staleSession = await prisma.session.create({
        data: { active: true, user: { connect: { id: user.id } } },
      })

      await completeGoogleSignIn({ sub, email, email_verified: true, name: 'First Sign In' })

      const refreshedStaleSession = await prisma.session.findUniqueOrThrow({ where: { id: staleSession.id } })
      expect(refreshedStaleSession.active).toBe(false)

      const activeSessions = await prisma.session.findMany({ where: { user_id: user.id, active: true } })
      expect(activeSessions).toHaveLength(1)
    })

    it('redirects to the login screen with an error code when the state is missing/mismatched', async () => {
      const response = await fetch('/api/auth/google/callback?code=whatever&state=wrong-state', { redirect: 'manual' })

      expect(response.status).toBe(302)
      expect(response.headers.get('location')).toBe('/login?oauth_error=auth.oauth_failed')
    })

    it('redirects to the login screen with an error code when the code exchange fails', async () => {
      const startResponse = await fetch('/api/auth/google', { redirect: 'manual' })
      const cookieHeader = stateCookie(getCookies(startResponse))
      const state = cookieHeader!.split('=')[1]

      const response = await fetch(`/api/auth/google/callback?code=unknown-code&state=${state}`, {
        redirect: 'manual',
        headers: { cookie: cookieHeader! },
      })

      expect(response.status).toBe(302)
      expect(response.headers.get('location')).toBe('/login?oauth_error=auth.oauth_failed')
    })

    it('rejects a callback carrying Google\'s own error param (denied consent)', async () => {
      const startResponse = await fetch('/api/auth/google', { redirect: 'manual' })
      const cookieHeader = stateCookie(getCookies(startResponse))
      const state = cookieHeader!.split('=')[1]

      const response = await fetch(`/api/auth/google/callback?error=access_denied&state=${state}`, {
        redirect: 'manual',
        headers: { cookie: cookieHeader! },
      })

      expect(response.status).toBe(302)
      expect(response.headers.get('location')).toBe('/login?oauth_error=auth.oauth_failed')
    })

    it('rejects an unverified Google email', async () => {
      const email = uniqueEmail('unverified-google-email')
      const response = await completeGoogleSignIn({
        sub: uniqueSub('unverified-google-email'),
        email,
        email_verified: false,
        name: 'Not Verified',
      })

      expect(response.status).toBe(302)
      expect(response.headers.get('location')).toBe('/login?oauth_error=auth.oauth_failed')

      await expect(prisma.user.findUnique({ where: { email } })).resolves.toBeNull()
    })
  })

  describe('null-password (Google-only) accounts', () => {
    async function createGoogleOnlyUser(label: string) {
      const email = uniqueEmail(label)
      await completeGoogleSignIn({ sub: uniqueSub(label), email, email_verified: true, name: 'Google Only' })
      return email
    }

    it('rejects password login with a distinct error code, not invalid_credentials', async () => {
      const email = await createGoogleOnlyUser('login-reject')

      await expect(
        $fetch('/api/auth/sessions', {
          method: 'POST',
          body: { email, password: 'Str0ng!Pass' },
        }),
      ).rejects.toMatchObject({ statusCode: 401, statusMessage: 'auth.password_not_set' })
    })

    it('does not send a password-reset email for a Google-only account', async () => {
      const email = await createGoogleOnlyUser('reset-reject')

      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ email }),
        headers: { 'content-type': 'application/json' },
      })

      expect(response.status).toBe(204)
      const outboxEntries = await prisma.emailOutbox.findMany({ where: { recipient_email: email, type: 'password-reset' } })
      expect(outboxEntries).toHaveLength(0)
    })
  })
})
