import { z } from 'zod'

// zod schema replacing the former CreatePushSubscriptionDto/
// UpdatePushSubscriptionDto (class-validator), used by the push-subscription
// registration endpoint. Unlike the former DTO (which carried the whole
// PushManager subscription JSON-stringified inside a single `subscription`
// field, then re-parsed server-side), the endpoint and keys are accepted as
// a plain typed object: there was never a reason for the double-encoding
// other than working around class-validator only validating flat DTOs.
export const createPushSubscriptionSchema = z.object({
  endpoint: z.url(),
  keys: z.object({
    auth: z.string().min(1),
    p256dh: z.string().min(1),
  }),
})

export type CreatePushSubscriptionInput = z.infer<typeof createPushSubscriptionSchema>
