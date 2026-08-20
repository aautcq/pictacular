import { generateRandomString } from './crypto'
import { prisma } from './prisma'

// Ported pattern from generateUniqueInvitationToken/generateUniqueVerificationToken:
// keeps generating a random token until one that isn't already in use is
// found. The DB-level @unique constraint on Album.share_token is the real
// guard against races; this check just avoids handing out an obviously
// colliding token. Called every time a Public Share Link (issue #53) is
// generated *or rotated* — there's no separate "rotate" endpoint, calling
// this again simply replaces whatever token was previously assigned.
export async function generateUniqueShareToken() {
  let token = ''

  do
    token = generateRandomString(32)
  while (await prisma.album.findUnique({ where: { share_token: token } }))

  return token
}
