import { randomBytes } from 'node:crypto'
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
