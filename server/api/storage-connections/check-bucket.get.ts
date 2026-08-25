import { prisma } from '#server/utils/prisma'
import { bucketHasImages } from '#server/utils/storage'

// Reports whether the authenticated User's connected bucket already
// contains images (issue #49's `check-bucket`), so the onboarding client
// can offer a later "import existing photos" step.
export default defineEventHandler(async (event) => {
  const { user } = requireAuth(event)

  const account = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    include: { aws_credentials: true },
  })

  if (!account.aws_credentials) {
    throw createError({
      statusCode: 400,
      statusMessage: 'storage.connection_required',
    })
  }

  const has_photos = await bucketHasImages(account.aws_credentials)

  return { has_photos }
})
