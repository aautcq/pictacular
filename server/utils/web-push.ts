import process from 'node:process'
import webpush from 'web-push'

export interface WebPushSubscription {
  endpoint: string
  keys: {
    auth: string
    p256dh: string
  }
}

// Plain web-push utility (no DI container / no Nest gateway), ported from
// the former GatewayService#sendPushNotification: builds the same
// `{ name, content: { title, body } }` JSON payload and sends it as a
// VAPID-signed push message via the `web-push` SDK. The VAPID subject used
// to be the dropped CLIENT_URL env var (see ADR 0001); a mailto: subject
// (the standard alternative for the VAPID JWT `sub` claim) replaces it since
// there's no longer a client origin to point at.
//
// This used to only ever be called inside a live Nitro request (the `push`
// WS message, always handled inside a live connection); issue #145's scan
// task changes that by calling it with no HTTP entry point at all, so
// `useRuntimeConfig` (an auto-import unavailable outside a live Nitro
// request/build) needs the same `typeof` guard + env var fallback
// server/utils/jwt.ts#verifyToken already uses for the same reason.
export async function sendPushNotification(
  subscription: WebPushSubscription,
  name: string,
  title: string,
  body: string,
) {
  const { publicKey, privateKey } = typeof useRuntimeConfig === 'function'
    ? useRuntimeConfig().webPush
    : { publicKey: process.env.NUXT_WEB_PUSH_PUBLIC_KEY as string, privateKey: process.env.NUXT_WEB_PUSH_PRIVATE_KEY as string }

  const options = {
    vapidDetails: {
      subject: 'mailto:pictacular@aautcq.com',
      publicKey,
      privateKey,
    },
    TTL: 60,
  }

  const payload = JSON.stringify({ name, content: { title, body } })

  await webpush.sendNotification(subscription, payload, options)
}
