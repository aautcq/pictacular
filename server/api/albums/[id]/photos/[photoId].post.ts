import { requireAlbumIdParam, requireAlbumMembership, requireOwnPhoto, requirePhotoIdRouteParam } from '#server/utils/album-guards'
import { prisma } from '#server/utils/prisma'
import { serializeAlbumFull } from '#server/utils/serialize-album'

// Adds one of the requesting User's own Photos to an Album they're a
// member of (issue #51). Idempotent (upserting the composite
// AlbumsOnPhotos key) so re-adding an already-assigned Photo is a no-op
// rather than a conflict — a photo picker toggling membership shouldn't
// need to track prior state itself.
export default defineEventHandler(async (event) => {
  const { user } = requireAuth(event)
  const albumId = requireAlbumIdParam(event)
  const photoId = requirePhotoIdRouteParam(event)

  const album = await requireAlbumMembership(albumId, user.id)
  await requireOwnPhoto(photoId, user.id)

  await prisma.albumsOnPhotos.upsert({
    where: { photo_id_album_id: { photo_id: photoId, album_id: albumId } },
    create: { photo_id: photoId, album_id: albumId },
    update: {},
  })

  return serializeAlbumFull(album, user.id)
})
