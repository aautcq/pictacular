import { requirePhotoStorageConnection } from '#server/utils/photo-guards'
import { prisma } from '#server/utils/prisma'
import { serializePhoto } from '#server/utils/serialize-photo'

// Lists the authenticated User's own Photos (issue #50), newest first,
// paginated via a keyset cursor (the last-seen Photo id) rather than
// offset/page, so pages stay stable while new Photos are uploaded. The
// client groups the flat, date-sorted list by day itself.
//
// "Newest" (issue #162) means each Photo's best-known date — its EXIF
// `taken_at` when one was found, else its `last_modified` — computed live
// via `COALESCE` rather than a denormalized column, so older Photos that
// predate this field never need a backfill/migration to sort correctly
// alongside newer ones that do have a `taken_at`. Prisma's query builder
// can't express "order by this or that column depending on which is null"
// as a single merged timeline, hence the two-step raw-SQL-for-ordering,
// then-hydrate-via-Prisma approach below.
export default defineEventHandler(async (event) => {
  const { user } = requireAuth(event)

  const query = getQuery(event)
  const result = photoListQuerySchema.safeParse(query)

  if (!result.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'photos.invalid_query',
    })
  }

  const { cursor, limit } = result.data

  const account = await requirePhotoStorageConnection(user.id)

  // The cursor Photo's own effective date anchors the keyset comparison
  // below — it must belong to this User, exactly like every other Photo
  // query here. A supplied cursor that no longer resolves to a real,
  // owned Photo (e.g. deleted between page requests) must fail loudly
  // rather than silently falling back to page 1 — that would look to a
  // client like the list had "restarted" with no error signal, and any
  // already-fetched pages would just get duplicated.
  const cursorPhoto = cursor
    ? await prisma.photo.findFirst({ where: { id: cursor, user_id: user.id }, select: { taken_at: true, last_modified: true } })
    : null

  if (cursor && !cursorPhoto) {
    throw createError({
      statusCode: 400,
      statusMessage: 'photos.invalid_cursor',
    })
  }

  const idRows = cursorPhoto
    ? await prisma.$queryRaw<{ id: number }[]>`
        SELECT id FROM photos
        WHERE user_id = ${user.id}
          AND (COALESCE(taken_at, last_modified), id) < (COALESCE(${cursorPhoto.taken_at}::timestamptz, ${cursorPhoto.last_modified}::timestamptz), ${cursor}::int)
        ORDER BY COALESCE(taken_at, last_modified) DESC, id DESC
        LIMIT ${limit + 1}
      `
    : await prisma.$queryRaw<{ id: number }[]>`
        SELECT id FROM photos
        WHERE user_id = ${user.id}
        ORDER BY COALESCE(taken_at, last_modified) DESC, id DESC
        LIMIT ${limit + 1}
      `

  const has_more = idRows.length > limit
  const requestedIds = idRows.slice(0, limit).map(row => row.id)

  const photosById = new Map(
    (await prisma.photo.findMany({
      where: { id: { in: requestedIds } },
      include: { likes: { select: { id: true } } },
    })).map(photo => [photo.id, photo]),
  )
  // Guards against a Photo being deleted in the (small) window between the
  // id-selection query above and this hydration query — rather than
  // asserting every requested id is still present.
  const pageIds = requestedIds.filter(id => photosById.has(id))
  const page = pageIds.map(id => photosById.get(id)!)

  return {
    photos: await Promise.all(page.map(photo => serializePhoto(photo, account.aws_credentials, user.id))),
    next_cursor: has_more ? requestedIds[requestedIds.length - 1] : null,
  }
})
