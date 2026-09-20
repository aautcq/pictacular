import { memberSelect } from '#server/utils/album-guards'
import { prisma } from '#server/utils/prisma'
import { findAlbumPhotoAssignment, loadAlbumPhotoIdPage } from '#server/utils/serialize-album'
import { publicPhotoImageUrl } from '#server/utils/serialize-photo'

// Public Share Link counterpart of GET /api/albums/:id/photos (issue
// #170): resolves a share token to its Album exactly like
// GET /api/albums/public/:token, then paginates its Photos the same
// keyset-cursor way — no session, no like-eligibility, every Photo URL
// scoped under the token (see publicPhotoImageUrl), matching the fields
// serializeAlbumPublic used to embed directly before pagination.
export default defineEventHandler(async (event) => {
  const token = getRouterParam(event, 'token')

  const album = token
    ? await prisma.album.findUnique({ where: { share_token: token }, include: { admin: { select: memberSelect } } })
    : null

  if (!album || !token) {
    throw createError({
      statusCode: 404,
      statusMessage: 'albums.not_found',
    })
  }

  const query = getQuery(event)
  const result = albumPhotosQuerySchema.safeParse(query)

  if (!result.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'albums.invalid_query',
    })
  }

  const { cursor, limit } = result.data

  const cursorAssignment = cursor ? await findAlbumPhotoAssignment(album.id, cursor) : null

  if (cursor && !cursorAssignment) {
    throw createError({
      statusCode: 400,
      statusMessage: 'albums.invalid_cursor',
    })
  }

  const { ids: requestedIds, hasMore } = await loadAlbumPhotoIdPage(album.id, cursor, cursorAssignment?.assigned_at, limit)

  const photosById = new Map(
    (await prisma.photo.findMany({
      where: { id: { in: requestedIds } },
      include: { user: { include: { storage_connection: true } } },
    })).map(photo => [photo.id, photo]),
  )

  const page = requestedIds
    .map(photoId => photosById.get(photoId))
    .filter(photo => photo !== undefined && photo.user.storage_connection)

  return {
    photos: page.map(photo => ({
      id: photo!.id,
      url: publicPhotoImageUrl(token, photo!.id),
      mime_type: photo!.mime_type,
      size: photo!.size,
      last_modified: photo!.last_modified,
      created_at: photo!.created_at,
    })),
    next_cursor: hasMore ? requestedIds[requestedIds.length - 1] : null,
  }
})
