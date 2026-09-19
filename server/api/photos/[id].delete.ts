import { requirePhotoIdParam, requirePhotoStorageConnection, withStorageConnectionGuard } from '#server/utils/photo-guards'
import { prisma } from '#server/utils/prisma'
import { deletePhotoObject } from '#server/utils/storage'

// Deletes one of the authenticated User's own Photos (issue #50): removes
// both the DB row and its underlying bucket object, so a delete never
// leaves an orphaned S3 object behind. Scoped to `user_id` so a User can
// never delete another User's Photo by guessing an id.
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

  await withStorageConnectionGuard(account.id, () => deletePhotoObject(account.storage_connection, photo.key))
  await prisma.photo.delete({ where: { id } })

  setResponseStatus(event, 204)
})
