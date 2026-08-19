import { Prisma } from '@prisma/client'
import { getPreferredLang } from '../../utils/i18n/lang'
import { sendEmail } from '../../utils/mailer'
import { registerSchema } from '../../utils/validation/register'
import { hashPassword } from '../../utils/crypto'
import { prisma } from '../../utils/prisma'
import { generateUniqueVerificationToken } from '../../utils/verification-token'

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

  // Fire-and-forget, matching the former controller: email delivery is not
  // on the registration's critical path/response.
  sendEmail({ email: user.email, link }, 'verification', lang)
    .catch(error => console.error('Failed to send verification email', error))

  setResponseStatus(event, 204)
})
