import { prisma } from '../../utils/prisma'

// Replaces the former UsersController#findOne (protected GET /users/me):
// returns the authenticated user's own profile fields.
export default defineEventHandler(async (event) => {
  const { user } = requireAuth(event)

  return await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    select: {
      id: true,
      email: true,
      created_at: true,
      last_sign_in_at: true,
    },
  })
})
