import type { CookieSerializeOptions } from 'cookie-es'
import process from 'node:process'
import { accessTokenTtl, refreshTokenTtl } from './jwt'

// Centralized cookie names/option constants, reused wherever the auth
// cookies are set/cleared (ported from the former api/src/auth/cookies.params.ts).
export const accessTokenCookieName = 'pictacularAccTok'
export const refreshTokenCookieName = 'pictacularRefTok'

// Dev mode serves plain `http://localhost` (see ADR 0001/issue #72): browsers
// silently drop `Secure` cookies on a non-HTTPS response, so `secure`/`sameSite`
// relax in dev via Nuxt's built-in `import.meta.dev` flag. Production/build
// behavior (`secure: true`, `sameSite: 'none'`) is unchanged.
const genericCookieOptions: CookieSerializeOptions = {
  httpOnly: true,
  sameSite: import.meta.dev ? 'lax' : 'none',
  secure: !import.meta.dev,
  path: '/',
  domain: process.env.NUXT_COOKIE_DOMAIN,
}

export const accessTokenCookieOptions: CookieSerializeOptions = {
  ...genericCookieOptions,
  maxAge: accessTokenTtl,
}

export const refreshTokenCookieOptions: CookieSerializeOptions = {
  ...genericCookieOptions,
  maxAge: refreshTokenTtl,
}

// Short-lived cookie bridging a WebAuthn options call (registration or
// assertion) to the following verify call: the challenge those two
// ceremonies must agree on can't be trusted from the client, and there's no
// server-side session to stash it in before an assertion logs the user in.
export const webauthnChallengeCookieName = 'pictacularWebauthnChallenge'

export const webauthnChallengeCookieOptions: CookieSerializeOptions = {
  ...genericCookieOptions,
  maxAge: 5 * 60,
}
