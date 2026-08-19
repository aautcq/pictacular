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
export async function sendPushNotification(
  subscription: WebPushSubscription,
  name: string,
  title: string,
  body: string,
) {
  const options = {
    vapidDetails: {
      subject: 'mailto:pictacular@aautcq.com',
      publicKey: process.env.WEB_PUSH_PUBLIC_KEY as string,
      privateKey: process.env.WEB_PUSH_PRIVATE_KEY as string,
    },
    TTL: 60,
  }

  const payload = JSON.stringify({ name, content: { title, body } })

  await webpush.sendNotification(subscription, payload, options)
}
