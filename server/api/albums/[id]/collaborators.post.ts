import { memberSelect, requireAlbumAdmin, requireAlbumIdParam, requireAlbumMembership } from '#server/utils/album-guards'
import { issueInvitationEmail } from '#server/utils/issue-invitation-email'
import { prisma } from '#server/utils/prisma'
import { serializeAlbumFull } from '#server/utils/serialize-album'
import { albumCollaboratorsSchema } from '#server/utils/validation/album'

// Adds Collaborators to an Album by email (issue #52), admin-only: an
// email matching an existing User connects them to the Album immediately;
// an unknown email instead gets a pending Invitation + email (or a resend
// of its existing one — see issueInvitationEmail — rather than an error,
// per the acceptance criteria).
export default defineEventHandler(async (event) => {
  const { user } = requireAuth(event)
  const id = requireAlbumIdParam(event)

  const album = await requireAlbumMembership(id, user.id)
  requireAlbumAdmin(album, user.id)

  const body = await readBody(event)
  const result = albumCollaboratorsSchema.safeParse(body)

  if (!result.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'albums.invalid_payload',
    })
  }

  const { emails } = result.data

  // Batches the existing-vs-unknown lookup into one query (rather than one
  // findUnique per email) and the resulting Collaborator links into one
  // update, then only invites the emails with no matching User — tracking
  // which of the two outcomes each email got so the client can report an
  // accurate "linked" vs "invited" result instead of a single generic
  // message (issue #52 acceptance criteria distinguishes the two).
  const existingUsers = await prisma.user.findMany({ where: { email: { in: emails } }, select: { ...memberSelect, email: true } })
  const existingUsersByEmail = new Map(existingUsers.map(existingUser => [existingUser.email, existingUser]))

  if (existingUsers.length) {
    await prisma.album.update({
      where: { id },
      data: { users: { connect: existingUsers.map(existingUser => ({ id: existingUser.id })) } },
    })
  }

  const invitedEmails: string[] = []
  for (const email of emails) {
    if (!existingUsersByEmail.has(email)) {
      await issueInvitationEmail(event, id, email)
      invitedEmails.push(email)
    }
  }

  const refreshed = await requireAlbumMembership(id, user.id)
  const full = await serializeAlbumFull(refreshed, user.id)

  return { ...full, linked: [...existingUsersByEmail.keys()], invited: invitedEmails }
})
