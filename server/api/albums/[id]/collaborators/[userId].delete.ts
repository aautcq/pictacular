import { requireAlbumAdmin, requireAlbumIdParam, requireAlbumMembership } from '#server/utils/album-guards'
import { prisma } from '#server/utils/prisma'
import { serializeAlbumFull } from '#server/utils/serialize-album'

// Removes a Collaborator from an Album (issue #52), admin-only. Removing
// the admin themselves isn't "removing a Collaborator" — there's a
// dedicated delete-Album endpoint for that — so it's rejected with 400
// rather than silently disconnecting the Album's own owner.
export default defineEventHandler(async (event) => {
  const { user } = requireAuth(event)
  const id = requireAlbumIdParam(event)
  const userId = Number(getRouterParam(event, 'userId'))

  if (!Number.isInteger(userId)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'albums.invalid_payload',
    })
  }

  const album = await requireAlbumMembership(id, user.id)
  requireAlbumAdmin(album, user.id)

  if (userId === album.admin_id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'albums.cannot_remove_admin',
    })
  }

  await prisma.album.update({
    where: { id },
    data: { users: { disconnect: { id: userId } } },
  })

  const refreshed = await requireAlbumMembership(id, user.id)
  return serializeAlbumFull(refreshed)
})
