import { createPage, setup, url } from '@nuxt/test-utils/e2e'
import { afterAll, describe, expect, it } from 'vitest'
import { hashPassword } from '../../server/utils/crypto'
import { prisma } from '../../server/utils/prisma'
import { addVirtualAuthenticator } from './webauthn-virtual-authenticator'

// Browser-driven test (issue #55): a signed-in User registers a biometric
// credential from their profile page (real navigator.credentials.create,
// answered by a CDP virtual authenticator standing in for a real device —
// see webauthn-virtual-authenticator.ts), then logs out and is signed back
// in automatically from the login screen because the credential-id cookie
// set at registration is present, without submitting the password form.
// Once that cookie is cleared (a different/reset device), the same
// credential can still be used via the manual "sign in with biometrics"
// action. Prior art: test/e2e/webauthn-authenticator.ts + auth-biometrics.test.ts
// cover the black-box HTTP side of the same ceremonies.
describe('biometric sign-in UI journey', async () => {
  await setup({ browser: true })

  const emailPrefix = `biometrics-ui-${Date.now()}`
  const email = `${emailPrefix}@example.com`
  const password = 'Str0ng!Pass'

  // WebAuthn requires either an https origin or "localhost" — the test
  // server's own url() always resolves to a bare 127.0.0.1 address (an IP,
  // not a registrable domain), which the WebAuthn spec explicitly rejects
  // as an RP ID/origin. Rewriting the hostname keeps every navigation on
  // the exempted "localhost" special case while still hitting the same
  // test server (127.0.0.1 and localhost both resolve to the loopback
  // interface it's bound to).
  function localhostUrl(path: string) {
    const rewritten = new URL(url(path))
    rewritten.hostname = 'localhost'
    return rewritten.toString()
  }

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { startsWith: emailPrefix } } })
  })

  it('registers a credential, signs in automatically, then via the manual action once the cookie is cleared', async () => {
    await prisma.user.create({
      data: {
        email,
        first_name: 'Jane',
        last_name: 'Doe',
        password: hashPassword(password),
        is_verified: true,
        verification_token: `token-${emailPrefix}`,
      },
    })

    const page = await createPage()
    await addVirtualAuthenticator(page)
    await page.goto(localhostUrl('/login'), { waitUntil: 'hydration' } as never)

    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password').fill(password)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()

    await page.waitForURL('**/storage-connection')
    await page.goto(localhostUrl('/profile'))
    await page.getByText(email).waitFor()

    await page.getByRole('button', { name: 'Register a biometric credential' }).click()
    await page.getByText('Biometric credential registered.').waitFor()

    const credentialCookie = (await page.context().cookies()).find(cookie => cookie.name === 'pictacularBiometricCredential')
    expect(credentialCookie?.value).toBeTruthy()

    await page.getByRole('button', { name: 'Log out' }).click()
    await page.waitForURL('**/login')

    // The credential-id cookie from registration above is still present,
    // so the login screen should attempt biometric sign-in on its own —
    // no password/manual click needed — and land back past the guard.
    await page.waitForURL('**/storage-connection')

    await page.getByRole('button', { name: 'Log out' }).click()
    await page.waitForURL('**/login')

    // Clear the credential-id cookie to simulate a device/browser that
    // never auto-attempts, then confirm the manual action still works
    // since the assertion ceremony is usernameless/discoverable.
    await page.context().clearCookies({ name: 'pictacularBiometricCredential' })
    await page.reload()
    await page.waitForURL('**/login')

    await page.getByRole('button', { name: 'Sign in with biometrics' }).click()
    await page.waitForURL('**/storage-connection')

    await page.close()
  }, 60_000)
})
