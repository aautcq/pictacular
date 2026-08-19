import { prisma } from './prisma'
import { generateRandomString } from './crypto'

// Ported from the former UsersService#getFreshToken: keeps generating a
// random token until one that isn't already in use is found. The DB-level
// @unique constraint on verification_token is the real guard against races;
// this check just avoids handing out an obviously-colliding token.
export async function generateUniqueVerificationToken() {
  let token = ''

  do
    token = generateRandomString(32)
  while (await prisma.user.findUnique({ where: { verification_token: token } }))

  return token
}
