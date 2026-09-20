import { Prisma } from '#server/generated/prisma/client'
import { decodeStorageConnectionLaunch } from '#server/utils/jwt'
import { prisma } from '#server/utils/prisma'
import { confirmStorageConnection } from '#server/utils/storage'

// Confirms a Storage Connection — either "create a new bucket" (issue
// #150) or "connect an existing bucket" (issue #152) — after the User has
// launched (and, they assert, finished) the CloudFormation stack POST
// /api/storage-connections/launch handed them: redeems the signed
// `pending_token` from that step for the Role ARN/bucket/External ID/mode
// Pictacular generated, assumes the Role to verify the stack really has
// finished creating it (AssumeRole itself is the "is it ready?" check —
// see server/utils/storage.ts#confirmStorageConnection), and persists the
// connection as the User's (one-per-user) StorageConnectionAccess row.
export default defineEventHandler(async (event) => {
  const { user } = requireAuth(event)

  const body = await readBody(event)
  const result = storageConnectionConfirmSchema.safeParse(body)

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

  const existing = await prisma.storageConnection.findUnique({ where: { user_id: user.id } })
  // A connection already known broken (issue #153) is the one case this
  // otherwise rejects as "already connected" — reconnecting always
  // replaces its Role/External Id/bucket in place with a fresh one below,
  // never repairs the old row, matching the same "always a fresh
  // Role/External Id" guarantee a brand-new connection gets.
  if (existing && !existing.broken) {
    throw createError({
      statusCode: 409,
      statusMessage: 'storage.already_connected',
    })
  }

  const pending = decodeStorageConnectionLaunch(result.data.pending_token)
  if (!pending || pending.user_id !== user.id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'storage.invalid_pending_token',
    })
  }

  const { bucket, region } = await confirmStorageConnection(pending.role_arn, pending.external_id, pending.bucket, pending.mode)

  try {
    if (existing) {
      await prisma.storageConnection.update({
        where: { user_id: user.id },
        data: { bucket, region, role_arn: pending.role_arn, external_id: pending.external_id, broken: false },
      })
    }
    else {
      await prisma.storageConnection.create({
        data: {
          bucket,
          region,
          role_arn: pending.role_arn,
          external_id: pending.external_id,
          user: { connect: { id: user.id } },
        },
      })
    }
  }
  catch (error) {
    // user_id is a unique column: the upfront findUnique check above is
    // TOCTOU-vulnerable to a concurrent connection attempt for the same
    // User (e.g. a double-click), so fall back to the DB's own
    // unique-constraint error (P2002) to keep the right 409 contract under
    // a race, matching the pattern already used by POST /auth/users.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw createError({
        statusCode: 409,
        statusMessage: 'storage.already_connected',
      })
    }
    throw error
  }

  setResponseStatus(event, 204)
})
