import { memberSelect } from '#server/utils/album-guards'
import { prisma } from '#server/utils/prisma'
import { loadAlbumCovers, serializeAlbumSummary } from '#server/utils/serialize-album'

// Lists the authenticated User's own Albums (issue #51) — every Album
// they're a member of (admin, or a Collaborator once issue #52 ships),
// newest first, paginated via a keyset cursor (the last-seen Album id), so
// pages stay stable as new Albums are created. Each row is the
// lightweight "card" shape (title + cover), matching the "list (with cover
// derived from a Photo)" acceptance criterion.
export default defineEventHandler(async (event) => {
  const { user } = requireAuth(event)

  const query = getQuery(event)
  const result = albumListQuerySchema.safeParse(query)

  if (!result.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'albums.invalid_query',
    })
  }

  const { cursor, limit } = result.data

  const albums = await prisma.album.findMany({
    where: { users: { some: { id: user.id } } },
    orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(cursor && { skip: 1, cursor: { id: cursor } }),
    include: { admin: { select: memberSelect } },
  })

  const has_more = albums.length > limit
  const page = albums.slice(0, limit)

  const { covers, photoCounts } = await loadAlbumCovers(page.map(album => album.id))

  return {
    albums: await Promise.all(page.map(album => serializeAlbumSummary(album, covers.get(album.id) ?? null, photoCounts.get(album.id) ?? 0))),
    next_cursor: has_more ? page[page.length - 1]?.id : null,
  }
})
