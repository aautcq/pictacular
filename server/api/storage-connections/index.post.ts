import { Prisma } from '../../generated/prisma/client'
import { encodeAwsCredentials } from '../../utils/jwt'
import { prisma } from '../../utils/prisma'
import { connectExistingBucket, createBucket } from '../../utils/storage'
import { storageConnectionSchema } from '../../utils/validation/storage-connection'

// Storage Connection onboarding endpoint (issue #49): a signed-in, verified
// User submits their own AWS key pair and either has Pictacular create a
// new bucket for them or names an existing one to connect (CORS is set up
// either way), then the connection is persisted as their (one-per-user)
// AwsCredentials row.
export default defineEventHandler(async (event) => {
  const { user } = requireAuth(event)

  const body = await readBody(event)
  const result = storageConnectionSchema.safeParse(body)

  if (!result.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'storage.invalid_payload',
    })
  }

  const existing = await prisma.awsCredentials.findUnique({ where: { user_id: user.id } })
  if (existing) {
    throw createError({
      statusCode: 409,
      statusMessage: 'storage.already_connected',
    })
  }

  const { mode, access_key_id, secret_access_key } = result.data
  const tokens = encodeAwsCredentials({ access_key_id, secret_access_key })
  const allowedOrigin = getRequestURL(event).origin

  const { bucket, region } = mode === 'create'
    ? await createBucket(tokens, allowedOrigin)
    : await connectExistingBucket(tokens, result.data.bucket, allowedOrigin)

  try {
    await prisma.awsCredentials.create({
      data: {
        bucket,
        region,
        tokens,
        user: { connect: { id: user.id } },
      },
    })
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
