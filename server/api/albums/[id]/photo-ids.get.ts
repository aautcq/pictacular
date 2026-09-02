import { requireAlbumIdParam, requireAlbumMembership } from '#server/utils/album-guards'
import { prisma } from '#server/utils/prisma'

// Lightweight membership lookup (issue #170): every Photo id currently
// assigned to an Album, with no join/URL/EXIF cost per row — cheap even
// for an Album with thousands of Photos, unlike GET /api/albums/:id/photos.
// Used by the photo picker (AddPhotoPickerModal) to render its "already
// in this album" checkmarks without paginating through the whole Album.
export default defineEventHandler(async (event) => {
  const { user } = requireAuth(event)
  const id = requireAlbumIdParam(event)

  await requireAlbumMembership(id, user.id)

  const rows = await prisma.albumsOnPhotos.findMany({
    where: { album_id: id },
    select: { photo_id: true },
  })

  return { photo_ids: rows.map(row => row.photo_id) }
})
