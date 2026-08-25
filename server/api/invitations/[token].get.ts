import { memberSelect } from '#server/utils/album-guards'
import { prisma } from '#server/utils/prisma'
import { loadAlbumCover, serializeAlbumSummary } from '#server/utils/serialize-album'

// Public endpoint (no auth) backing the Invitation screen (issue #52):
// resolves an Invitation token to its Album's summary (title/description/
// cover/admin) plus the invited email, so the screen can show "you've been
// invited to <Album>" and prefill/lock the signup form's email field. A
// non-existent/already-accepted token gets the same 404 either way, so it
// can't be distinguished from a probing guess. Also reports whether the
// invited email already belongs to a registered (but not yet accepted —
// see requireAlbumMembership/verify — since an already-verified match
// would already have been linked and its Invitation deleted) User: that
// can happen when someone registers on their own between being invited and
// following the link, and the screen uses it to offer "resend my
// verification email" instead of a signup form that would otherwise fail
// with auth.email_taken.
export default defineEventHandler(async (event) => {
  const token = getRouterParam(event, 'token')

  const invitation = token
    ? await prisma.invitation.findUnique({
        where: { token },
        include: { album: { include: { admin: { select: memberSelect } } } },
      })
    : null

  if (!invitation) {
    throw createError({
      statusCode: 404,
      statusMessage: 'invitations.not_found',
    })
  }

  const cover = await loadAlbumCover(invitation.album_id)
  const summary = await serializeAlbumSummary(invitation.album, cover)
  const existingUser = await prisma.user.findUnique({ where: { email: invitation.email } })

  return { ...summary, email: invitation.email, has_pending_account: !!existingUser }
})
