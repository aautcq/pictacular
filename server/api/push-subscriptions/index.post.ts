import { prisma } from '#server/utils/prisma'

// Replaces the former PushSubscriptionsController#create (protected POST
// /push-subscriptions): stores an endpoint + keys pair for the
// authenticated user only — the target is always event.context.user, never
// a request-supplied id.
export default defineEventHandler(async (event) => {
  const { user } = requireAuth(event)

  const body = await readBody(event)
  const result = createPushSubscriptionSchema.safeParse(body)

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

  const { endpoint, keys } = result.data

  const subscription = await prisma.pushSubscription.create({
    data: {
      endpoint,
      keys: JSON.stringify(keys),
      user: { connect: { id: user.id } },
    },
    select: { id: true },
  })

  setResponseStatus(event, 201)
  return subscription
})
