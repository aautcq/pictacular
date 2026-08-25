import { requireAlbumIdParam, requireAlbumMembership, requirePhotoIdRouteParam } from '#server/utils/album-guards'
import { prisma } from '#server/utils/prisma'
import { serializeAlbumFull } from '#server/utils/serialize-album'

// Removes a Photo from an Album (issue #51). Only removes the
// AlbumsOnPhotos join row — the Photo itself is untouched, since it still
// belongs to its own personal library. Idempotent (deleteMany rather than
// a findFirst-then-delete) so removing an already-absent assignment is a
// no-op rather than a 404.
export default defineEventHandler(async (event) => {
  const { user } = requireAuth(event)
  const albumId = requireAlbumIdParam(event)
  const photoId = requirePhotoIdRouteParam(event)

  const album = await requireAlbumMembership(albumId, user.id)

  await prisma.albumsOnPhotos.deleteMany({ where: { album_id: albumId, photo_id: photoId } })

  return serializeAlbumFull(album, user.id)
})
