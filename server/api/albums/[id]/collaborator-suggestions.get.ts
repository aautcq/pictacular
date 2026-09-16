import { memberSelect, requireAlbumAdmin, requireAlbumIdParam, requireAlbumMembership } from '#server/utils/album-guards'
import { prisma } from '#server/utils/prisma'

// Powers the Collaborators-modal typeahead (see ADR 0012), admin-only:
// rather than exposing the full user directory to any signed-in User by
// name/email substring, suggestions are restricted to Users who are
// currently a Collaborator on at least one *other* Album this admin owns
// — i.e. "people you've already invited somewhere" — computed live from
// `Album.users`, not a persisted "known contacts" list. A brand-new
// invitee never appears here and must be typed out in full (the
// CommandPalette's free-text fallback still creates the pending
// Invitation, same as before).
export default defineEventHandler(async (event) => {
  const { user } = requireAuth(event)
  const id = requireAlbumIdParam(event)

  const album = await requireAlbumMembership(id, user.id)
  requireAlbumAdmin(album, user.id)

  const query = getQuery(event)
  const result = albumCollaboratorSuggestionsQuerySchema.safeParse(query)

  if (!result.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'albums.invalid_query',
    })
  }

  const { q, limit } = result.data

  const existingMemberIds = album.users.map(member => member.id)

  const suggestions = await prisma.user.findMany({
    where: {
      id: { notIn: existingMemberIds },
      // Currently a Collaborator (or admin — irrelevant here since it'd
      // have to be someone else's own album) on some other Album this
      // requesting User admins.
      albums: { some: { admin_id: user.id, id: { not: id } } },
      OR: [
        { first_name: { contains: q, mode: 'insensitive' } },
        { last_name: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
      ],
    },
    select: { ...memberSelect, email: true },
    take: limit,
    orderBy: [{ first_name: 'asc' }, { last_name: 'asc' }],
  })

  return { suggestions }
})
