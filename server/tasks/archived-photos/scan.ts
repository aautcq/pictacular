import type { Task } from 'nitropack/types'
import { isArchivedStorageClass, photoArchiveState } from '#server/utils/archived-photo'
import { withStorageConnectionGuard } from '#server/utils/photo-guards'
import { prisma } from '#server/utils/prisma'
import { serializePhoto } from '#server/utils/serialize-photo'
import { headObjectRestoreStatus, listAllBucketImages } from '#server/utils/storage'
import { sendPushNotification } from '#server/utils/web-push'
import { sendMessageToUser } from '#server/utils/websocket'

// Same reasoning as server/tasks/email-outbox/process.ts's `Task`-typed
// plain object: `defineTask` pulls in a build-only virtual import that
// throws when this file is imported standalone by a Vitest spec (this
// task has no HTTP entry point either — see
// test/e2e/archived-photos-task.test.ts).

// Notifies a User that a Restore Request has completed (issue #145's
// story 9), reusing the same WS + web-push infra `photo:uploaded` already
// uses (server/utils/websocket.ts, server/utils/web-push.ts) rather than
// inventing a second notification path.
async function notifyPhotoRestored(userId: number, photo: Parameters<typeof serializePhoto>[0]) {
  const serialized = serializePhoto(photo, userId)
  sendMessageToUser(userId, 'photo:restored', serialized)

  const subscriptions = await prisma.pushSubscription.findMany({ where: { user_id: userId } })

  await Promise.all(subscriptions.map(subscription =>
    sendPushNotification(
      { endpoint: subscription.endpoint, keys: JSON.parse(subscription.keys) },
      'photo:restored',
      'Photo restored',
      'One of your archived photos is available again.',
    ).catch((error) => {
      // A push failing (expired/invalid subscription, provider outage)
      // shouldn't abort the rest of the scan, matching the WS message
      // handler's own try/catch-and-log behavior.
      console.error('Failed to send restore push notification', error)
    }),
  ))
}

// Runs `fn` over `items` with at most `concurrency` in flight at once. An
// earlier version of this task made its per-photo `HeadObject` calls
// (this loop's only per-object AWS round trip) fully sequentially, which
// took untenably long against a bucket with thousands of Archived Photos
// — bounded concurrency keeps the scan fast without opening an unbounded
// number of simultaneous AWS connections for a very large bucket.
async function mapWithConcurrency<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  let index = 0

  async function worker() {
    while (index < items.length) {
      const item = items[index++]!
      await fn(item)
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker))
}

const archivedPhotosScanTask: Task = {
  meta: {
    name: 'archived-photos:scan',
    description: 'Detects Archived Photos (Glacier/Deep Archive) across every Storage Connection bucket, tracks Restore Request status, and notifies Users when a restore completes',
  },
  async run() {
    const accounts = await prisma.user.findMany({
      // A connection issue #153 has already marked broken is skipped
      // entirely rather than retried every scan cycle — its owner is
      // already hard-blocked and directed to reconnect, so retrying a
      // doomed AssumeRole here would only waste an STS round trip.
      where: { storage_connection: { isNot: null, is: { broken: false } } },
      include: { storage_connection: true },
    })

    for (const account of accounts) {
      const storageConnection = account.storage_connection!

      // One User's broken Storage Connection (revoked credentials, bucket
      // deleted, ...) must not abort the scan for every other User —
      // logged and skipped instead, the same "keep going" resilience
      // email-outbox's own per-row try/catch already relies on. Routed
      // through the same broken-connection guard (issue #153) as the
      // interactive routes, so a Role revoked since the last scan gets
      // marked broken here too instead of being retried forever.
      try {
        const images = await withStorageConnectionGuard(account.id, () => listAllBucketImages(storageConnection))
        if (images.length === 0)
          continue

        // Only Photos this User already has a row for are updated — an
        // object the User hasn't imported/uploaded through Pictacular yet
        // has no Photo row to attach this state to.
        const photos = await prisma.photo.findMany({
          where: { user_id: account.id, key: { in: images.map(image => image.key) } },
          include: { likes: { select: { id: true } } },
        })
        const photoByKey = new Map(photos.map(photo => [photo.key, photo]))

        for (const image of images) {
          const photo = photoByKey.get(image.key)
          if (!photo)
            continue

          // `ListObjectsV2`'s `StorageClass` field is free (no per-object
          // AWS call) — Photos not archived by that field are updated
          // inline here, one connected user's bucket at a time, since
          // this branch never makes an AWS call and so has no latency
          // worth parallelizing.
          if (!isArchivedStorageClass(image.storage_class)) {
            if (photo.storage_class !== image.storage_class || photo.restore_ongoing || photo.restore_expires_at) {
              await prisma.photo.update({
                where: { id: photo.id },
                data: { storage_class: image.storage_class, restore_ongoing: false, restore_expires_at: null },
              })
            }
          }
        }

        // `HeadObject` (issue #145's story 15) is only issued for Photos
        // already known to be archived from the free `StorageClass`
        // field above, never for every Photo — but run with bounded
        // concurrency rather than one at a time, since a bucket can have
        // thousands of Archived Photos and this is the only per-object
        // AWS call in the whole scan.
        const archivedImages = images.filter(image => photoByKey.has(image.key) && isArchivedStorageClass(image.storage_class))

        await mapWithConcurrency(archivedImages, 20, async (image) => {
          const photo = photoByKey.get(image.key)!
          const previousState = photoArchiveState(photo)
          const status = await withStorageConnectionGuard(account.id, () => headObjectRestoreStatus(storageConnection, image.key))

          const updated = await prisma.photo.update({
            where: { id: photo.id },
            data: {
              storage_class: status.storage_class,
              restore_ongoing: status.ongoing,
              restore_expires_at: status.expires_at,
            },
            include: { likes: { select: { id: true } } },
          })

          // A transition into `restored` (rather than every scan while
          // already `restored`) is what fires the notification, so a
          // re-run of this idempotent task never double-notifies (issue
          // #145's story 14).
          if (previousState === 'restoring' && photoArchiveState(updated) === 'restored')
            await notifyPhotoRestored(account.id, updated)
        })
      }
      catch (error) {
        console.error(`archived-photos:scan failed for user ${account.id}`, error)
      }
    }

    return { result: 'success' }
  },
}

export default archivedPhotosScanTask
