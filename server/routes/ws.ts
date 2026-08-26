import type { AccessToken } from '#server/utils/jwt'
import { parse } from 'cookie-es'
import { defineWebSocketHandler } from 'h3'
import { accessTokenCookieName } from '#server/utils/cookies'
import { verifyToken } from '#server/utils/jwt'
import { prisma } from '#server/utils/prisma'
import { sendPushNotification } from '#server/utils/web-push'
import { registerPeer, unregisterPeer } from '#server/utils/websocket'

// Native-WebSocket rewrite of the former Socket.IO GatewayService, using
// Nitro's `defineWebSocketHandler` (h3/crossws) — a wire-protocol rewrite,
// not a lift-and-shift, since crossws isn't Socket.IO-wire-compatible.
// Connections are authenticated the same way HTTP requests are (the
// `pictacularAccTok` cookie, verified during the upgrade instead of via
// server/middleware/auth.ts, which only runs for HTTP requests).
export default defineWebSocketHandler({
  upgrade(request) {
    const cookies = parse(request.headers.get('cookie') ?? '')
    const accessToken = cookies[accessTokenCookieName]
    const payload = accessToken ? verifyToken<AccessToken>(accessToken) : null

    if (!payload)
      return new Response('Unauthorized', { status: 401 })

    request.context.user = payload.user
  },

  open(peer) {
    registerPeer(peer)
  },

  close(peer) {
    unregisterPeer(peer)
  },

  // The only client-originated message kind accepted is `push` (triggering
  // a push notification for the sending peer's own subscriptions), and it's
  // validated with the same zod-schema convention every HTTP route in this
  // rewrite uses (see server/utils/validation/websocket.ts for why the
  // former client-triggered `broadcast` kind was removed rather than
  // allow-listed, per #43).
  async message(peer, message) {
    let json: unknown
    try {
      json = message.json()
    }
    catch {
      return
    }

    const result = pushMessageSchema.safeParse(json)
    if (!result.success)
      return

    const { name = 'notification', title, body } = result.data
    const user = peer.context.user as AccessToken['user']
    const subscriptions = await prisma.pushSubscription.findMany({ where: { user_id: user.id } })

    await Promise.all(subscriptions.map(subscription =>
      sendPushNotification(
        { endpoint: subscription.endpoint, keys: JSON.parse(subscription.keys) },
        name,
        title,
        body,
      ).catch((error) => {
        // A push failing (expired/invalid subscription, provider outage)
        // shouldn't take down the WS connection, matching the former
        // gateway's try/catch-and-log behavior.
        console.error('Failed to send push notification', error)
      }),
    ))
  },
})
