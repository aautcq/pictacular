import { Prisma } from '#server/generated/prisma/client'
import { burnPasswordCompareTime, hashPassword } from '#server/utils/crypto'
import { issueEmailViaOutbox } from '#server/utils/email-outbox'
import { getPreferredLang } from '#server/utils/i18n/lang'
import { prisma } from '#server/utils/prisma'
import { generateUniqueVerificationToken } from '#server/utils/verification-token'

// Replaces the former AuthController#register (POST /auth/users): creates
// an unverified user with a hashed password and a verification token, then
// emails a verification link in the requester's language.
//
// Always responds 204, whether or not the email is already taken — to
// prevent account enumeration, a taken email can't be distinguished (by
// response, or by timing — see burnPasswordCompareTime) from a fresh one:
// - already registered + unverified: silently re-sends that account's
//   existing verification email (same effect as the dedicated
//   resend-verification endpoint), so a person who forgot they'd already
//   signed up still gets back on track.
// - already registered + verified: silent no-op.
export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const result = registerSchema.safeParse(body)

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

  const { email, first_name, last_name, password } = result.data

  const existingUser = await prisma.user.findUnique({ where: { email } })
  if (existingUser) {
    // Burn the same wall-clock time a real signup would spend hashing its
    // password, so this branch's latency doesn't give away that the email
    // is already taken. This doesn't equalize the smaller delta from the
    // new-registration path's extra DB round-trips (generateUniqueVerificationToken's
    // lookup, the user insert) — those are a few ms against bcrypt's
    // ~60-100ms at cost 10, i.e. noise next to the signal this closes, so
    // they're accepted as residual rather than padded out.
    burnPasswordCompareTime()

    if (!existingUser.is_verified) {
      const link = `${getRequestURL(event).origin}/verification/${existingUser.verification_token}`
      const lang = getPreferredLang(event)
      await issueEmailViaOutbox('verification', existingUser.email, link, lang)
    }

    setResponseStatus(event, 204)
    return
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
    // error (P2002) to keep the right contract under a race. Under the
    // `@prisma/adapter-pg` driver adapter (Prisma 7), the conflicting
    // column isn't reported via the classic `error.meta.target` — it's
    // nested in the underlying pg driver error instead — so read both
    // shapes, preferring the driver adapter's since that's what's actually
    // populated here.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const driverAdapterError = error.meta?.driverAdapterError as { cause?: { constraint?: { fields?: string[] } } } | undefined
      const target = driverAdapterError?.cause?.constraint?.fields ?? error.meta?.target
      const conflictsOnEmail = Array.isArray(target) ? target.includes('email') : target === 'email'

      // An email conflict here means another concurrent request just won
      // the race to register this exact (previously unseen) address — its
      // own request already sent that account's verification email, so
      // this loser just no-ops into the same identical 204 as every other
      // already-registered-email case above (no enumeration via a race
      // window). A verification_token collision is a real, unrelated
      // system error (a token-generation collision), not enumeration-
      // sensitive, so it still surfaces as an error.
      if (conflictsOnEmail) {
        setResponseStatus(event, 204)
        return
      }

      throw createError({
        statusCode: 409,
        statusMessage: 'auth.verification_token_taken',
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
