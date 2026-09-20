import { Prisma } from '#server/generated/prisma/client'
import { comparePassword, hashPassword } from '#server/utils/crypto'
import { prisma } from '#server/utils/prisma'

// Replaces the former UsersController#update (protected PATCH /users/:id):
// updates the authenticated user's own account details only — the target
// is always event.context.user, never a request-supplied id, so this
// cannot be used to modify another account.
export default defineEventHandler(async (event) => {
  const { user } = requireAuth(event)

  const body = await readBody(event)
  const result = updateUserSchema.safeParse(body)

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

  const { email, first_name, last_name, password, current_password } = result.data

  if (password !== undefined) {
    const account = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })

    // Issue #157: a Google-only account has no current password to verify
    // — reject with the same distinct auth.password_not_set code the
    // login endpoint uses, rather than crashing comparePassword against a
    // null hash.
    if (!account.password) {
      throw createError({
        statusCode: 401,
        statusMessage: 'auth.password_not_set',
      })
    }

    if (!comparePassword(current_password!, account.password)) {
      throw createError({
        statusCode: 401,
        statusMessage: 'auth.invalid_credentials',
      })
    }
  }

  try {
    return await prisma.user.update({
      where: { id: user.id },
      data: {
        ...(email !== undefined && { email }),
        ...(first_name !== undefined && { first_name }),
        ...(last_name !== undefined && { last_name }),
        ...(password !== undefined && { password: hashPassword(password) }),
      },
      select: {
        id: true,
        email: true,
        first_name: true,
        last_name: true,
        created_at: true,
        last_sign_in_at: true,
      },
    })
  }
  catch (error) {
    // email is a unique column: surface the same auth.email_taken contract
    // used by registration when the requested email is already taken.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw createError({
        statusCode: 409,
        statusMessage: 'auth.email_taken',
      })
    }
    throw error
  }
})
