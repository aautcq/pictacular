import { Buffer } from 'node:buffer'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import bcrypt from 'bcrypt'

// Plain crypto utility module (no DI container), ported from the former
// NestJS CryptoService.
export function generateRandomString(length: number): string {
  return randomBytes(length).toString('base64url')
}

export function hashPassword(password: string): string {
  const salt = bcrypt.genSaltSync(10)
  return bcrypt.hashSync(password, salt)
}

export function comparePassword(password: string, hash: string): boolean {
  return bcrypt.compareSync(password, hash)
}

// bcrypt silently truncates its input at 72 bytes, which is fine for
// user-chosen passwords but unsafe for long opaque secrets such as RS256
// refresh JWTs: two distinct tokens for the same session share the same
// first 72 bytes (only iat/exp/signature differ, all beyond that window),
// so bcrypt would wrongly treat a superseded, already-rotated-out token as
// matching the freshly-rotated hash. Use a full SHA-256 digest compared in
// constant time instead.
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function compareToken(token: string, hash: string): boolean {
  const tokenHash = Buffer.from(hashToken(token), 'hex')
  const storedHash = Buffer.from(hash, 'hex')

  return tokenHash.length === storedHash.length && timingSafeEqual(tokenHash, storedHash)
}
