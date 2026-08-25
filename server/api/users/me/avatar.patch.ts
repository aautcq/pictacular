import { prisma } from '#server/utils/prisma'
import { serializeUser } from '#server/utils/serialize-user'
import { uploadAvatarObject } from '#server/utils/storage'
import { avatarUploadSchema } from '#server/utils/validation/avatar'

// Replaces the former UsersController#updateAvatar (protected PATCH
// /me/avatar): uploads/replaces the authenticated user's avatar image in
// their own Storage Connection bucket and persists the new key. A User
// must have already set up a Storage Connection (AWS credentials) —
// avatars are stored there like every other image asset, per ADR 0001 —
// so this rejects with users.storage_connection_required until that
// onboarding step (a separate ticket) exists.
export default defineEventHandler(async (event) => {
  const { user } = requireAuth(event)

  const body = await readBody(event)
  const result = avatarUploadSchema.safeParse(body)

  if (!result.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'users.invalid_payload',
    })
  }

  const account = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    include: { aws_credentials: true },
  })

  if (!account.aws_credentials) {
    throw createError({
      statusCode: 400,
      statusMessage: 'users.storage_connection_required',
    })
  }

  const { mime_type, base64 } = result.data
  const key = await uploadAvatarObject(account.aws_credentials, account.id, mime_type, base64)

  const updated = await prisma.user.update({
    where: { id: account.id },
    data: { avatar_url: key },
    select: { id: true, email: true, first_name: true, last_name: true, created_at: true, last_sign_in_at: true },
  })

  return serializeUser({ ...updated, avatar_url: key, aws_credentials: account.aws_credentials })
})
