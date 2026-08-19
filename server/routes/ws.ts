import { parse } from 'cookie-es'
import { defineWebSocketHandler } from 'h3'
import { accessTokenCookieName } from '../utils/cookies'
import type { AccessToken } from '../utils/jwt'
import { verifyToken } from '../utils/jwt'
import { prisma } from '../utils/prisma'
import { sendPushNotification } from '../utils/web-push'
import { registerPeer, sendMessage, unregisterPeer } from '../utils/websocket'

interface BroadcastMessage {
  type: 'broadcast'
  name: string
  data?: unknown
}

interface PushMessage {
  type: 'push'
  name?: string
  title: string
  body: string
}

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

  async message(peer, message) {
    let payload: BroadcastMessage | PushMessage
    try {
      payload = message.json<BroadcastMessage | PushMessage>()
    }
    catch {
      return
    }

    if (payload.type === 'push') {
      const { name = 'notification', title, body } = payload
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
      return
    }

    sendMessage(payload.name, payload.data)
  },
})
