import process from 'node:process'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../server/generated/prisma/client.ts'
import { generateRandomString, hashPassword } from '../server/utils/crypto.ts'

// Local dev seed: fake Users + Albums to test the collaboration features
// (Album Collaborators and Invitations) without registering accounts by
// hand. Safe to re-run (`prisma db seed`) — every write upserts/find-or-
// creates on a stable natural key rather than assuming an empty DB.
//
// Not wired into Nitro's `#server/...` alias (that only resolves inside
// the Nuxt/Nitro build), so this imports the generated Prisma client and
// server/utils/crypto directly by relative path and builds its own
// PrismaClient instead of importing the server/utils/prisma singleton.

if (!process.env.NUXT_DATABASE_URL)
  throw new Error('Environment variable not found: NUXT_DATABASE_URL')

const adapter = new PrismaPg({ connectionString: process.env.NUXT_DATABASE_URL })
const prisma = new PrismaClient({ adapter })

// Every seeded User shares this password and is pre-verified, so you can
// log in immediately without going through the email verification step.
const PASSWORD = 'Password123!'

async function upsertVerifiedUser(email: string, firstName: string, lastName: string) {
  return prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      first_name: firstName,
      last_name: lastName,
      password: hashPassword(PASSWORD),
      is_verified: true,
      verification_token: generateRandomString(32),
    },
  })
}

// Albums have no natural unique key of their own, so this finds an
// existing Album by (admin, title) rather than using `prisma.album.upsert`.
async function findOrCreateAlbum(adminId: number, title: string, collaboratorIds: number[] = []) {
  const existing = await prisma.album.findFirst({ where: { admin_id: adminId, title } })
  if (existing) {
    if (collaboratorIds.length > 0) {
      await prisma.album.update({
        where: { id: existing.id },
        data: { users: { connect: collaboratorIds.map(id => ({ id })) } },
      })
    }
    return existing
  }

  return prisma.album.create({
    data: {
      title,
      admin_id: adminId,
      users: { connect: collaboratorIds.map(id => ({ id })) },
    },
  })
}

async function main() {
  const alice = await upsertVerifiedUser('alice@test.local', 'Alice', 'Anderson')
  const bob = await upsertVerifiedUser('bob@test.local', 'Bob', 'Baker')
  const carol = await upsertVerifiedUser('carol@test.local', 'Carol', 'Clarke')

  // Fast path: Bob is already a collaborator, so logging in as Bob shows
  // the Album immediately.
  await findOrCreateAlbum(alice.id, 'Alice\'s Trip', [bob.id])

  // Invitation path: dave@test.local has no User yet, so this exercises
  // signing up via the invite link and landing in the Album as a new
  // collaborator.
  const carolsGarden = await findOrCreateAlbum(carol.id, 'Carol\'s Garden')
  await prisma.invitation.upsert({
    where: { album_id_email: { album_id: carolsGarden.id, email: 'dave@test.local' } },
    update: {},
    create: {
      album_id: carolsGarden.id,
      email: 'dave@test.local',
      token: generateRandomString(32),
    },
  })

  // eslint-disable-next-line no-console
  console.log(`Seeded Users (password: ${PASSWORD}): alice@test.local, bob@test.local, carol@test.local`)
  // eslint-disable-next-line no-console
  console.log('Seeded Albums: "Alice\'s Trip" (Bob is a collaborator), "Carol\'s Garden" (pending invitation to dave@test.local)')
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
