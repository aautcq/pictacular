import { requirePhotoIdParam, requirePhotoStorageConnection } from '#server/utils/photo-guards'
import { prisma } from '#server/utils/prisma'
import { serializePhoto } from '#server/utils/serialize-photo'

// Unlikes one of the authenticated User's own Photos (issue #50) — the
// inverse of POST /api/photos/[id]/like.
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

  const updated = await prisma.photo.update({
    where: { id },
    data: { likes: { disconnect: { id: user.id } } },
    include: { likes: { select: { id: true } } },
  })

  return serializePhoto(updated, account.aws_credentials, user.id)
})
