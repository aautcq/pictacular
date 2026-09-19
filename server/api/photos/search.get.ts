import { requireAlbumMembership } from '#server/utils/album-guards'
import { requirePhotoStorageConnection } from '#server/utils/photo-guards'
import { prisma } from '#server/utils/prisma'
import { serializePhoto, uuidKeyPrefixSqlPattern } from '#server/utils/serialize-photo'

// Searches Photos by filename (issue #190): library-wide (no `album_id`)
// matches a Photo's own filename OR the title of any Album it belongs to
// — a Photo can belong to several Albums, so title matching is a
// meaningful, separate way to find one from the whole library. Scoped to
// one Album (`album_id` given) matches filename only — that Album's
// title is already the fixed context, so matching it wouldn't narrow
// anything — and requires membership (Collaborators included), same as
// GET /api/albums/:id/photos. Either way, this returns a single capped
// batch of matches, newest-first, never further-paginated — mirroring
// GET /api/albums/search, since callers only ever render a "top matches"
// result set, not the whole match set.
//
// Filename matching happens in SQL against `key`'s own last path segment
// with the same optional UUID prefix stripped as filenameFromKey (see
// serialize-photo.ts) — not a plain `key`-contains-`q`, which would false-
// positive match every uploaded Photo's fixed `photos/<userId>/` prefix
// segment for a query like "photo".
export default defineEventHandler(async (event) => {
  const { user } = requireAuth(event)

  const query = getQuery(event)
  const result = photoSearchQuerySchema.safeParse(query)

  if (!result.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'photos.invalid_query',
    })
  }

  const { q, album_id, limit } = result.data
  const pattern = `%${q}%`

  const ids = album_id === undefined
    ? await searchOwnPhotoIds(user.id, pattern, limit)
    : await searchAlbumPhotoIds(album_id, user.id, pattern, limit)

  const photosById = new Map(
    (await prisma.photo.findMany({
      where: { id: { in: ids } },
      include: { user: { include: { storage_connection: true } }, likes: { select: { id: true } } },
    })).map(photo => [photo.id, photo]),
  )

  // Preserves the requested (newest-first) order and drops any Photo
  // whose owner currently has no Storage Connection, matching the
  // filtering GET /api/albums/:id/photos already applies to Photos that
  // may belong to a different member than the requesting User.
  const photos = ids
    .map(id => photosById.get(id))
    .filter(photo => photo !== undefined && photo.user.storage_connection)
    .map((photo) => {
      const { user: _user, ...rest } = photo!
      return serializePhoto(rest, user.id)
    })

  return { photos }
})

async function searchOwnPhotoIds(userId: number, pattern: string, limit: number): Promise<number[]> {
  await requirePhotoStorageConnection(userId)

  const rows = await prisma.$queryRaw<{ id: number }[]>`
    SELECT p.id FROM photos p
    WHERE p.user_id = ${userId}
      AND (
        regexp_replace(split_part(p.key, '/', -1), ${uuidKeyPrefixSqlPattern}, '', 'i') ILIKE ${pattern}
        OR EXISTS (
          SELECT 1 FROM "AlbumsOnPhotos" aop
          JOIN albums a ON a.id = aop.album_id
          WHERE aop.photo_id = p.id AND a.title ILIKE ${pattern}
        )
      )
    ORDER BY COALESCE(p.taken_at, p.last_modified) DESC, p.id DESC
    LIMIT ${limit}
  `

  return rows.map(row => row.id)
}

async function searchAlbumPhotoIds(albumId: number, userId: number, pattern: string, limit: number): Promise<number[]> {
  await requireAlbumMembership(albumId, userId)

  const rows = await prisma.$queryRaw<{ id: number }[]>`
    SELECT p.id FROM photos p
    JOIN "AlbumsOnPhotos" aop ON aop.photo_id = p.id
    WHERE aop.album_id = ${albumId}
      AND regexp_replace(split_part(p.key, '/', -1), ${uuidKeyPrefixSqlPattern}, '', 'i') ILIKE ${pattern}
    ORDER BY COALESCE(p.taken_at, p.last_modified) DESC, p.id DESC
    LIMIT ${limit}
  `

  return rows.map(row => row.id)
}
