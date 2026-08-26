import { requirePhotoStorageConnection } from '#server/utils/photo-guards'
import { prisma } from '#server/utils/prisma'
import { serializePhoto } from '#server/utils/serialize-photo'
import { uploadPhotoObject } from '#server/utils/storage'
import { sendMessageToUser } from '#server/utils/websocket'

// Uploads a new Photo into the authenticated User's own Storage
// Connection bucket (issue #50), persists a Photo row for it, and emits a
// "photo uploaded" WS notification scoped to that User's own connections
// (see server/utils/websocket.ts#sendMessageToUser), so any other open tab
// of theirs updates in real time without polling.
export default defineEventHandler(async (event) => {
  const { user } = requireAuth(event)

  const body = await readBody(event)
  const result = photoUploadSchema.safeParse(body)

  if (!result.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'validation.invalid_payload',
      data: {
        errors: result.error.issues.map(issue => ({
          name: issue.path[0],
          message: issue.message,
        })),
      },
    })
  }

  const account = await requirePhotoStorageConnection(user.id)

  const { filename, mime_type, base64, last_modified } = result.data
  const { key, size } = await uploadPhotoObject(account.aws_credentials, account.id, filename, mime_type, base64)

  const photo = await prisma.photo.create({
    data: {
      key,
      mime_type,
      size,
      last_modified: last_modified ? new Date(last_modified) : new Date(),
      user: { connect: { id: account.id } },
    },
    include: { likes: { select: { id: true } } },
  })

  const serialized = await serializePhoto(photo, account.aws_credentials, user.id)

  sendMessageToUser(user.id, 'photo:uploaded', serialized)

  setResponseStatus(event, 201)
  return serialized
})
