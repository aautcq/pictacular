import { prisma } from '#server/utils/prisma'
import { serializeUser } from '#server/utils/serialize-user'

// Replaces the former UsersController#findOne (protected GET /users/me):
// returns the authenticated user's own profile fields, plus a signed
// avatar URL when the user has both an avatar and a Storage Connection —
// mirroring the shape already returned by the login endpoint.
export default defineEventHandler(async (event) => {
  const { user } = requireAuth(event)

  const account = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    select: {
      id: true,
      email: true,
      first_name: true,
      last_name: true,
      avatar_url: true,
      created_at: true,
      last_sign_in_at: true,
      aws_credentials: true,
    },
  })

  return serializeUser(account)
})
