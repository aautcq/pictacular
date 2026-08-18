import process from 'node:process'
import type { CookieSerializeOptions } from 'cookie-es'
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
