import { Prisma } from '../../generated/prisma/client'
import { comparePassword, hashPassword } from '../../utils/crypto'
import { prisma } from '../../utils/prisma'
import { updateUserSchema } from '../../utils/validation/update-user'

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
      statusMessage: 'users.invalid_payload',
    })
  }

  const { email, first_name, last_name, password, current_password } = result.data

  if (password !== undefined) {
    const account = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
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
