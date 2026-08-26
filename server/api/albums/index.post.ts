import { memberSelect } from '#server/utils/album-guards'
import { prisma } from '#server/utils/prisma'
import { serializeAlbumSummary } from '#server/utils/serialize-album'

// Creates a new Album (issue #51) owned by the authenticated User, who
// becomes both its admin and its (only, so far) member — connecting them
// to `users` too, not just `admin`, so requireAlbumMembership's single
// membership check already covers the admin without special-casing them.
// A brand-new Album has no Photos yet, so its cover is always null.
export default defineEventHandler(async (event) => {
  const { user } = requireAuth(event)

  const body = await readBody(event)
  const result = albumCreateSchema.safeParse(body)

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

  const { title, description } = result.data

  const album = await prisma.album.create({
    data: {
      title,
      description,
      admin: { connect: { id: user.id } },
      users: { connect: { id: user.id } },
    },
    include: { admin: { select: memberSelect } },
  })

  setResponseStatus(event, 201)
  return serializeAlbumSummary(album, null)
})
