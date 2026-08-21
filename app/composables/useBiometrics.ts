import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/types'
import type { CurrentUser } from './useCurrentUser'
import { browserSupportsWebAuthn, startAuthentication, startRegistration } from '@simplewebauthn/browser'

// Cookie flagging that this device has registered a biometric credential
// before (issue #55): the login screen reads it to decide whether to
// silently attempt a biometric sign-in. It is *not* itself sent back to the
// server as a credential identifier — the assertion ceremony is usernameless/
// discoverable (see server/utils/webauthn.ts's empty allowCredentials), so
// the authenticator itself picks a matching credential. Non-httpOnly since
// it only needs to be readable by this client-side check.
const credentialCookieName = 'pictacularBiometricCredential'
const credentialCookieMaxAge = 60 * 60 * 24 * 365

// WebAuthn (biometrics) client ceremonies (issue #55): wraps
// @simplewebauthn/browser's navigator.credentials.create/get calls around
// the already-implemented server/api/auth/biometrics/** endpoints, kept
// separate from useCurrentUser so the WebAuthn-specific plumbing (options
// fetch, ceremony, cookie bookkeeping) doesn't leak into the session
// composable.
export function useBiometrics() {
  const storedCredentialId = useCookie<string | null>(credentialCookieName, { maxAge: credentialCookieMaxAge })

  const hasStoredCredential = computed(() => !!storedCredentialId.value)
  const isSupported = import.meta.client ? browserSupportsWebAuthn() : false

  async function registerCredential() {
    const options = await $fetch<PublicKeyCredentialCreationOptionsJSON>('/api/auth/biometrics/registration-options')
    const response = await startRegistration(options)
    const { credential_id } = await $fetch<{ credential_id: string }>('/api/auth/biometrics', {
      method: 'POST',
      body: response,
    })
    storedCredentialId.value = credential_id
  }

  async function signIn() {
    const options = await $fetch<PublicKeyCredentialRequestOptionsJSON>('/api/auth/biometrics/assertion-options')
    const response = await startAuthentication(options)
    const user = await $fetch<CurrentUser>('/api/auth/biometrics/verify', { method: 'POST', body: response })
    storedCredentialId.value = response.id
    return user
  }

  return { hasStoredCredential, isSupported, registerCredential, signIn }
}
