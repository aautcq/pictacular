import { Prisma } from '#server/generated/prisma/client'
import { hashPassword } from '#server/utils/crypto'
import { issueEmailViaOutbox } from '#server/utils/email-outbox'
import { getPreferredLang } from '#server/utils/i18n/lang'
import { prisma } from '#server/utils/prisma'
import { registerSchema } from '#server/utils/validation/register'
import { generateUniqueVerificationToken } from '#server/utils/verification-token'

// Replaces the former AuthController#register (POST /auth/users): creates
// an unverified user with a hashed password and a verification token, then
// emails a verification link in the requester's language.
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const result = registerSchema.safeParse(body)

  if (!result.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'auth.invalid_payload',
      data: result.error.issues.map(issue => ({
        name: issue.path[0],
        message: issue.message,
      })),
    })
  }

  const { email, first_name, last_name, password } = result.data

  const existingUser = await prisma.user.findUnique({ where: { email } })
  if (existingUser) {
    throw createError({
      statusCode: 409,
      statusMessage: 'auth.email_taken',
    })
  }

  const verificationToken = await generateUniqueVerificationToken()

  let user
  try {
    user = await prisma.user.create({
      data: {
        email,
        first_name,
        last_name,
        password: hashPassword(password),
        verification_token: verificationToken,
      },
      select: { email: true, verification_token: true },
    })
  }
  catch (error) {
    // email and verification_token are both unique columns: the upfront
    // findUnique/generateUniqueVerificationToken checks above are
    // TOCTOU-vulnerable to a concurrent registration for the same address
    // or a colliding token, so fall back to the DB's own unique-constraint
    // error (P2002) to keep the right contract under a race. Prisma reports
    // which column collided via error.meta.target.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const target = error.meta?.target
      const conflictsOnEmail = Array.isArray(target) ? target.includes('email') : target === 'email'

      throw createError({
        statusCode: 409,
        statusMessage: conflictsOnEmail ? 'auth.email_taken' : 'auth.verification_token_taken',
      })
    }
    throw error
  }

  const link = `${getRequestURL(event).origin}/verification/${user.verification_token}`
  const lang = getPreferredLang(event)

  // Routed through the durable outbox (issue #92) instead of a bare
  // sendEmail call: awaiting here only waits for the pending row write (so
  // the send outcome is queryable as soon as this responds), not for the
  // email send itself, which stays off the registration's critical
  // path/response.
  await issueEmailViaOutbox('verification', user.email, link, lang)

  setResponseStatus(event, 204)
})
