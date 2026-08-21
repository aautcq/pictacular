import type { Page } from 'playwright-core'

// Adds a Chrome DevTools Protocol virtual authenticator to a browser-test
// page's context (issue #55): stands in for a real platform authenticator
// so the ported registration/sign-in UI's `navigator.credentials.create`/
// `.get` calls resolve automatically, without needing a real device or
// user interaction. Resident-key + user-verification support match the
// registration options `server/utils/webauthn.ts` requests (residentKey:
// 'required'); `automaticPresenceSimulation` skips the "please interact
// with your authenticator" step a real prompt would otherwise require.
export async function addVirtualAuthenticator(page: Page) {
  const client = await page.context().newCDPSession(page)
  await client.send('WebAuthn.enable')

  const { authenticatorId } = await client.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  })

  return { client, authenticatorId }
}
