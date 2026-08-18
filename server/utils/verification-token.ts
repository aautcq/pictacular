import { prisma } from './prisma'
import { generateRandomString } from './crypto'

// Ported from the former UsersService#getFreshToken: keeps generating a
// random token until one that isn't already in use is found.
export async function generateUniqueVerificationToken() {
  let token = ''

  do
    token = generateRandomString(32)
  while (await prisma.user.findFirst({ where: { verification_token: token } }))

  return token
}
