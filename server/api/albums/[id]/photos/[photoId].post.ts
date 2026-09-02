import { requireAlbumIdParam, requireAlbumMembership, requireOwnPhoto, requirePhotoIdRouteParam } from '#server/utils/album-guards'
import { prisma } from '#server/utils/prisma'
import { serializePhoto } from '#server/utils/serialize-photo'

// Adds one of the requesting User's own Photos to an Album they're a
// member of (issue #51). Idempotent (upserting the composite
// AlbumsOnPhotos key) so re-adding an already-assigned Photo is a no-op
// rather than a conflict — a photo picker toggling membership shouldn't
// need to track prior state itself. Returns just the affected Photo
// (issue #170) rather than the whole Album — an Album can hold thousands
// of Photos, so re-serializing all of them on every single toggle would
// defeat the point of paginating GET /api/albums/:id/photos; the client
// merges this one Photo into its own already-loaded page(s) instead.
export default defineEventHandler(async (event) => {
  const { user } = requireAuth(event)
  const albumId = requireAlbumIdParam(event)
  const photoId = requirePhotoIdRouteParam(event)

  await requireAlbumMembership(albumId, user.id)
  const photo = await requireOwnPhoto(photoId, user.id)

  await prisma.albumsOnPhotos.upsert({
    where: { photo_id_album_id: { photo_id: photoId, album_id: albumId } },
    create: { photo_id: photoId, album_id: albumId },
    update: {},
  })

  const withLikes = await prisma.photo.findUniqueOrThrow({
    where: { id: photo.id },
    include: { likes: { select: { id: true } } },
  })

  return serializePhoto(withLikes, user.id)
})
