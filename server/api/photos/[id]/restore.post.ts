import { requirePhotoIdParam, requirePhotoStorageConnection, withStorageConnectionGuard } from '#server/utils/photo-guards'
import { requestPhotoRestore } from '#server/utils/photo-restore'
import { prisma } from '#server/utils/prisma'
import { serializePhoto } from '#server/utils/serialize-photo'

// Requests a Restore Request for one of the authenticated User's own
// Archived Photos (issue #145), scoped to `user_id` the same way
// delete/like already are so a User can never restore another User's
// Photo by guessing an id.
export default defineEventHandler(async (event) => {
  const { user } = requireAuth(event)
  const id = requirePhotoIdParam(event)

  const account = await requirePhotoStorageConnection(user.id)

  const photo = await prisma.photo.findFirst({ where: { id, user_id: user.id } })
  if (!photo) {
    throw createError({
      statusCode: 404,
      statusMessage: 'photos.not_found',
    })
  }

  const updated = await withStorageConnectionGuard(account.id, () => requestPhotoRestore(photo, account.aws_credentials))

  return serializePhoto(updated, user.id)
})
