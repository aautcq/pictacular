import { requirePhotoStorageConnection } from '../../utils/photo-guards'
import { prisma } from '../../utils/prisma'
import { serializePhoto } from '../../utils/serialize-photo'
import { photoListQuerySchema } from '../../utils/validation/photo'

// Lists the authenticated User's own Photos (issue #50), newest first,
// paginated via a keyset cursor (the last-seen Photo id) rather than
// offset/page, so pages stay stable while new Photos are uploaded. The
// client groups the flat, date-sorted list by day itself.
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

  const photos = await prisma.photo.findMany({
    where: { user_id: user.id },
    orderBy: [{ last_modified: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(cursor && { skip: 1, cursor: { id: cursor } }),
    include: { likes: { select: { id: true } } },
  })

  const has_more = photos.length > limit
  const page = photos.slice(0, limit)

  return {
    photos: await Promise.all(page.map(photo => serializePhoto(photo, account.aws_credentials, user.id))),
    next_cursor: has_more ? page[page.length - 1]?.id : null,
  }
})
