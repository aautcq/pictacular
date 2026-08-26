import { z } from 'zod'

// zod schema for the only client-originated WS message kind left after
// #43: triggering a push notification for the sending peer's own
// subscriptions. The former client-triggered `broadcast` message kind
// (`{ type: 'broadcast', name, data }`, fanned out verbatim to every
// connected peer via server/utils/websocket.ts#sendMessage) was removed
// entirely rather than allow-listed, since it had no legitimate caller
// (no client code sends it) and `sendMessage` was only ever designed for
// server-side code reacting to other events, per its own doc comment.
export const pushMessageSchema = z.object({
  type: z.literal('push'),
  name: z.string().min(1).optional(),
  title: z.string().min(1),
  body: z.string().min(1),
})

export type PushMessageInput = z.infer<typeof pushMessageSchema>
