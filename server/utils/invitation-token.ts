import { generateRandomString } from './crypto'
import { prisma } from './prisma'

// Ported pattern from generateUniqueVerificationToken/generateResetPasswordToken:
// keeps generating a random token until one that isn't already in use is
// found. The DB-level @unique constraint on Invitation.token is the real
// guard against races; this check just avoids handing out an obviously
// colliding token.
export async function generateUniqueInvitationToken() {
  let token = ''

  do
    token = generateRandomString(32)
  while (await prisma.invitation.findUnique({ where: { token } }))

  return token
}
