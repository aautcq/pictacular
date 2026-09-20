import type { H3Event } from 'h3'
import {
  accessTokenCookieName,
  accessTokenCookieOptions,
  refreshTokenCookieName,
  refreshTokenCookieOptions,
} from './cookies'
import { hashToken } from './crypto'
import { createTokens } from './jwt'
import { prisma } from './prisma'

// Shared "successful sign-in" side effects, reused by password login
// (server/api/auth/sessions.post.ts), biometrics
// (server/api/auth/biometrics/verify.post.ts), and Google OAuth
// (server/api/auth/google/callback.get.ts): creates a new Session, revokes
// the User's other active Sessions, stamps last_sign_in_at, and issues the
// signed access/refresh JWT cookies. Returns the fresh last_sign_in_at so
// callers can serialize an up-to-date User payload.
export async function issueSession(event: H3Event, user: { id: number, email: string }) {
  const session = await prisma.session.create({
    data: {
      active: true,
      user_agent: getHeader(event, 'user-agent'),
      user: { connect: { id: user.id } },
    },
  })

  await prisma.session.updateMany({
    where: {
      user_id: user.id,
      active: true,
      NOT: { id: session.id },
    },
    data: { active: false, refresh_token: null },
  })

  const { last_sign_in_at } = await prisma.user.update({
    where: { id: user.id },
    data: { last_sign_in_at: new Date() },
  })

  const { accessToken, refreshToken } = createTokens(user, session)

  // See hashToken (server/utils/crypto.ts) for why refresh tokens use a
  // SHA-256 digest rather than bcrypt hashPassword.
  await prisma.session.update({
    where: { id: session.id },
    data: { refresh_token: hashToken(refreshToken) },
  })

  setCookie(event, accessTokenCookieName, accessToken, accessTokenCookieOptions)
  setCookie(event, refreshTokenCookieName, refreshToken, refreshTokenCookieOptions)

  return last_sign_in_at
}
