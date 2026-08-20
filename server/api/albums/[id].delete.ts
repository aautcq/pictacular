import { requireAlbumAdmin, requireAlbumIdParam, requireAlbumMembership } from '../../utils/album-guards'
import { prisma } from '../../utils/prisma'

// Deletes an Album (issue #51), restricted to its admin — a Collaborator
// who's a member but not the admin gets a 403, enforced server-side (not
// just hidden in the UI), per the acceptance criteria. Deleting an Album
// only removes its AlbumsOnPhotos join rows and the Album row itself;
// the underlying Photos (and their bucket objects) are untouched, since
// they still belong to their own owner's personal library.
export default defineEventHandler(async (event) => {
  const { user } = requireAuth(event)
  const id = requireAlbumIdParam(event)

  const album = await requireAlbumMembership(id, user.id)
  requireAlbumAdmin(album, user.id)

  await prisma.albumsOnPhotos.deleteMany({ where: { album_id: id } })
  await prisma.album.delete({ where: { id } })

  setResponseStatus(event, 204)
})
