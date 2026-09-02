import { requireAlbumIdParam, requireAlbumMembership, requirePhotoIdRouteParam } from '#server/utils/album-guards'
import { prisma } from '#server/utils/prisma'

// Removes a Photo from an Album (issue #51). Only removes the
// AlbumsOnPhotos join row — the Photo itself is untouched, since it still
// belongs to its own personal library. Idempotent (deleteMany rather than
// a findFirst-then-delete) so removing an already-absent assignment is a
// no-op rather than a 404. Returns no body (issue #170), matching
// DELETE /api/albums/:id and /api/photos/:id — the client already knows
// which Photo it removed and just splices it out of its own paginated
// list, rather than needing the whole Album re-serialized.
export default defineEventHandler(async (event) => {
  const { user } = requireAuth(event)
  const albumId = requireAlbumIdParam(event)
  const photoId = requirePhotoIdRouteParam(event)

  await requireAlbumMembership(albumId, user.id)

  await prisma.albumsOnPhotos.deleteMany({ where: { album_id: albumId, photo_id: photoId } })

  setResponseStatus(event, 204)
})
