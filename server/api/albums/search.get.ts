import { memberSelect } from '#server/utils/album-guards'
import { prisma } from '#server/utils/prisma'
import { loadAlbumCovers, serializeAlbumSummary } from '#server/utils/serialize-album'
import { albumSearchQuerySchema } from '#server/utils/validation/album'

// Searches the authenticated User's own Albums by keyword (issue #51),
// matching the title or description case-insensitively. Same lightweight
// "card" shape as the list endpoint, since search results feed the same
// albums-list UI.
export default defineEventHandler(async (event) => {
  const { user } = requireAuth(event)

  const query = getQuery(event)
  const result = albumSearchQuerySchema.safeParse(query)

  if (!result.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'albums.invalid_query',
    })
  }

  const { q, limit } = result.data

  const albums = await prisma.album.findMany({
    where: {
      users: { some: { id: user.id } },
      OR: [
        { title: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
      ],
    },
    orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
    take: limit,
    include: { admin: { select: memberSelect } },
  })

  const covers = await loadAlbumCovers(albums.map(album => album.id))

  return {
    albums: await Promise.all(albums.map(album => serializeAlbumSummary(album, covers.get(album.id) ?? null))),
  }
})
