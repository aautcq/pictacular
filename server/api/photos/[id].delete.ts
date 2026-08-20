import { requirePhotoIdParam, requirePhotoStorageConnection } from '../../utils/photo-guards'
import { prisma } from '../../utils/prisma'
import { deletePhotoObject } from '../../utils/storage'

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

  await deletePhotoObject(account.aws_credentials, photo.key)
  await prisma.photo.delete({ where: { id } })

  setResponseStatus(event, 204)
})
