import { memberSelect, requireAlbumIdParam, requireAlbumMembership } from '../../utils/album-guards'
import { prisma } from '../../utils/prisma'
import { loadAlbumCover, serializeAlbumSummary } from '../../utils/serialize-album'
import { albumUpdateSchema } from '../../utils/validation/album'

// Updates an Album's title/description (issue #51). Any member (not just
// the admin) can rename/edit it — only delete is admin-restricted, per
// the acceptance criteria's explicit "(admin-only)" annotation on delete
// alone.
export default defineEventHandler(async (event) => {
  const { user } = requireAuth(event)
  const id = requireAlbumIdParam(event)

  await requireAlbumMembership(id, user.id)

  const body = await readBody(event)
  const result = albumUpdateSchema.safeParse(body)

  if (!result.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'albums.invalid_payload',
    })
  }

  const album = await prisma.album.update({
    where: { id },
    data: result.data,
    include: { admin: { select: memberSelect } },
  })

  return serializeAlbumSummary(album, await loadAlbumCover(id))
})
