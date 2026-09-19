import { requireAlbumIdParam, requireAlbumMembership } from '#server/utils/album-guards'
import { prisma } from '#server/utils/prisma'
import { findAlbumPhotoAssignment, loadAlbumPhotoIdPage } from '#server/utils/serialize-album'
import { serializePhoto } from '#server/utils/serialize-photo'

// Lists an Album's assigned Photos (issue #170), newest-assigned-first,
// paginated via a keyset cursor exactly like GET /api/photos — an Album
// can hold thousands of Photos, so the full show endpoint
// (GET /api/albums/:id) no longer embeds them at all. Restricted to
// members (404 for anyone else), same as the full show endpoint.
export default defineEventHandler(async (event) => {
  const { user } = requireAuth(event)
  const id = requireAlbumIdParam(event)

  await requireAlbumMembership(id, user.id)

  const query = getQuery(event)
  const result = albumPhotosQuerySchema.safeParse(query)

  if (!result.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'albums.invalid_query',
    })
  }

  const { cursor, limit } = result.data

  // The cursor Photo's own AlbumsOnPhotos assignment anchors the keyset
  // comparison below — it must actually belong to this Album, exactly
  // like GET /api/photos' own cursor guard. A supplied cursor that no
  // longer resolves to an assignment (e.g. the Photo was removed between
  // page requests) fails loudly rather than silently restarting at page
  // 1, which would look like the list "reset" with no error signal.
  const cursorAssignment = cursor ? await findAlbumPhotoAssignment(id, cursor) : null

  if (cursor && !cursorAssignment) {
    throw createError({
      statusCode: 400,
      statusMessage: 'albums.invalid_cursor',
    })
  }

  const { ids: requestedIds, hasMore } = await loadAlbumPhotoIdPage(id, cursor, cursorAssignment?.assigned_at, limit)

  const photosById = new Map(
    (await prisma.photo.findMany({
      where: { id: { in: requestedIds } },
      include: { user: { include: { storage_connection: true } }, likes: { select: { id: true } } },
    })).map(photo => [photo.id, photo]),
  )

  // Preserves the requested keyset order (Map/findMany order isn't
  // guaranteed to match), then drops any Photo whose owner currently has
  // no Storage Connection — matching the previous serializeAlbumFull's
  // filter — without letting either guard shrink the page below `limit`
  // affect the cursor, which is still derived from the full requested id
  // list below.
  const page = requestedIds
    .map(photoId => photosById.get(photoId))
    .filter(photo => photo !== undefined && photo.user.storage_connection)

  return {
    photos: page.map((photo) => {
      const { user: _user, ...rest } = photo!
      return serializePhoto(rest, user.id)
    }),
    next_cursor: hasMore ? requestedIds[requestedIds.length - 1] : null,
  }
})
