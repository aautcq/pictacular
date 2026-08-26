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

// Fixed hash (bcrypt.hashSync('dummy-password-for-timing-parity', 10),
// precomputed rather than generated at import time to avoid paying its
// cost on every cold start) used solely to burn the same ~bcrypt-compare
// wall-clock time on paths that skip a real comparePassword call (e.g.
// login/registration for an email that doesn't match the branch it would
// otherwise take) — without this, an attacker could distinguish those
// branches by response latency alone, even though the response body/
// status is already identical (account-enumeration via timing).
const DUMMY_PASSWORD_HASH = '$2b$10$sZowi7M1AAQrtcIOV9vN3O0l0bGaHnBI9kqgZluqkTY9fzDROKcQu'

export function burnPasswordCompareTime(): void {
  bcrypt.compareSync('irrelevant', DUMMY_PASSWORD_HASH)
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
