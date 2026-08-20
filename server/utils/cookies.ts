import type { CookieSerializeOptions } from 'cookie-es'
import process from 'node:process'
import { accessTokenTtl, refreshTokenTtl } from './jwt'

// Centralized cookie names/option constants, reused wherever the auth
// cookies are set/cleared (ported from the former api/src/auth/cookies.params.ts).
export const accessTokenCookieName = 'pictacularAccTok'
export const refreshTokenCookieName = 'pictacularRefTok'

const genericCookieOptions: CookieSerializeOptions = {
  httpOnly: true,
  sameSite: 'none',
  secure: true,
  path: '/',
  domain: process.env.COOKIE_DOMAIN,
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
