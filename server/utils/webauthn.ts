import type { H3Event } from 'h3'
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server'
import { isoBase64URL } from '@simplewebauthn/server/helpers'
import type {
  AuthenticationResponseJSON,
  AuthenticatorDevice,
  RegistrationResponseJSON,
} from '@simplewebauthn/types'

const rpName = 'Pictacular'

// The app is same-origin (see ADR 0001 dropping CLIENT_HOST/CLIENT_URL), so
// the WebAuthn Relying Party ID/origin are derived from the incoming
// request rather than a dedicated env var: rpID is the bare hostname (no
// port, per the WebAuthn spec), origin is the full scheme+host(+port).
function getRelyingParty(event: H3Event) {
  const url = getRequestURL(event)
  return { rpID: url.hostname, origin: url.origin }
}

export function getRegistrationOptions(event: H3Event, user: { id: number, email: string }, excludeCredentialIds: string[]) {
  const { rpID } = getRelyingParty(event)

  return generateRegistrationOptions({
    rpName,
    rpID,
    userID: String(user.id),
    userName: user.email,
    userDisplayName: user.email,
    attestationType: 'none',
    // The assertion flow (getAssertionOptions below) is usernameless: it
    // sends no allowCredentials and relies on the authenticator itself
    // surfacing a matching discoverable credential. That only works if the
    // credential registered here is discoverable (resident) rather than a
    // server-side (non-discoverable) one, hence forcing residentKey.
    authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'preferred' },
    excludeCredentials: excludeCredentialIds.map(id => ({ id: isoBase64URL.toBuffer(id), type: 'public-key' })),
  })
}

export async function verifyRegistration(event: H3Event, response: RegistrationResponseJSON, expectedChallenge: string) {
  const { rpID, origin } = getRelyingParty(event)

  // verifyRegistrationResponse throws (rather than returning verified: false)
  // for most mismatches (wrong challenge/origin/RP ID, malformed response,
  // ...): they're all just as much a failed registration as verified: false,
  // so they're normalized to the same null result here.
  try {
    const { verified, registrationInfo } = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
    })

    if (!verified || !registrationInfo)
      return null

    return {
      credentialId: isoBase64URL.fromBuffer(registrationInfo.credentialID),
      publicKey: isoBase64URL.fromBuffer(registrationInfo.credentialPublicKey),
      counter: registrationInfo.counter,
    }
  }
  catch {
    return null
  }
}

export function getAssertionOptions(event: H3Event) {
  const { rpID } = getRelyingParty(event)

  // No allowCredentials: the client discovers which credential to use
  // (usernameless/discoverable login), matching the pre-login state where
  // the user isn't identified yet.
  return generateAuthenticationOptions({ rpID, userVerification: 'preferred' })
}

export async function verifyAssertion(event: H3Event, response: AuthenticationResponseJSON, expectedChallenge: string, biometrics: { credential_id: string, public_key: string, counter: number }) {
  const { rpID, origin } = getRelyingParty(event)

  const authenticator: AuthenticatorDevice = {
    credentialID: isoBase64URL.toBuffer(biometrics.credential_id),
    credentialPublicKey: isoBase64URL.toBuffer(biometrics.public_key),
    counter: biometrics.counter,
  }

  // Same normalization as verifyRegistration: a thrown mismatch is just
  // another failed assertion as far as the caller (verify.post.ts) is
  // concerned, and must be rejected as unauthorized either way.
  try {
    const { verified, authenticationInfo } = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      authenticator,
    })

    if (!verified)
      return null

    return { newCounter: authenticationInfo.newCounter }
  }
  catch {
    return null
  }
}
