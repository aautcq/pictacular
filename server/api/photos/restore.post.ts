import { archivedStorageClasses } from '#server/utils/archived-photo'
import { requirePhotoStorageConnection } from '#server/utils/photo-guards'
import { requestPhotoRestore } from '#server/utils/photo-restore'
import { prisma } from '#server/utils/prisma'
import { serializePhoto } from '#server/utils/serialize-photo'

// Bulk-restores every one of the authenticated User's own currently
// Archived Photos in a single request (issue #145's "restore all"
// action) — a plain loop over the same per-Photo restore flow the single
// endpoint uses, not S3 Batch Operations (see ADR 0005). Only Photos
// whose *persisted* state is plain `archived` are targeted: one already
// `restoring`/`restored` is left alone rather than re-checked here, since
// the single endpoint's own HeadObject check already handles that case
// for a User who restores it individually instead.
export default defineEventHandler(async (event) => {
  const { user } = requireAuth(event)

  const account = await requirePhotoStorageConnection(user.id)

  const archivedPhotos = await prisma.photo.findMany({
    where: {
      user_id: user.id,
      storage_class: { in: [...archivedStorageClasses] },
      restore_ongoing: false,
      OR: [
        { restore_expires_at: null },
        { restore_expires_at: { lte: new Date() } },
      ],
    },
  })

  // `allSettled` (not `all`) so one Photo's restore failing (e.g. the S3
  // object was deleted directly in AWS since the last scan) doesn't
  // discard the other Photos' already-applied AWS/DB side effects —
  // each `requestPhotoRestore` call independently issues its own
  // `RestoreObjectCommand` and `prisma.photo.update`, so a `Promise.all`
  // rejecting here would hide those already-successful outcomes from the
  // response.
  const settled = await Promise.allSettled(
    archivedPhotos.map(photo => requestPhotoRestore(photo, account.aws_credentials)),
  )
  const updated = settled
    .filter(result => result.status === 'fulfilled')
    .map(result => result.value)
  const failed = settled.filter(result => result.status === 'rejected').length

  const photos = updated.map(photo => serializePhoto(photo, user.id))

  return { restored: photos.length, failed, photos }
})
