import { prisma } from './prisma'

// Shared by the email-verification endpoint
// (server/api/auth/verify/[token].get.ts) and the Google sign-up flow
// (server/api/auth/google/callback.get.ts): issue #52's "verifying is this
// app's finishing signup moment" applies identically to a brand-new Google
// sign-up, which is created already-verified and so never goes through
// that endpoint's own token step. Any pending Invitation(s) for the User's
// email become Collaborator access right here, then get cleared so a
// later re-invite starts fresh rather than resurrecting a stale row.
export async function fulfillPendingInvitations(userId: number, email: string) {
  const invitations = await prisma.invitation.findMany({ where: { email } })

  for (const invitation of invitations) {
    await prisma.album.update({
      where: { id: invitation.album_id },
      data: { users: { connect: { id: userId } } },
    })
  }

  if (invitations.length) {
    await prisma.invitation.deleteMany({ where: { email } })
  }
}
