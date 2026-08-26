import type { AwsCredentials } from './storage'
import { isArchivedStorageClass } from './archived-photo'
import { prisma } from './prisma'
import { headObjectRestoreStatus, restoreObject } from './storage'

export interface RestorablePhoto {
  id: number
  key: string
}

// Shared restore-request flow (issue #145) used by both the single-Photo
// and bulk restore endpoints: checks the object's current status first
// (via HeadObject) so a restore already in flight or already completed
// (started directly in AWS, outside Pictacular, or by a previous call)
// never issues a redundant `RestoreObjectCommand`, then persists the
// resulting state on the Photo row.
export async function requestPhotoRestore(photo: RestorablePhoto, awsCredentials: AwsCredentials) {
  const status = await headObjectRestoreStatus(awsCredentials, photo.key)

  if (!isArchivedStorageClass(status.storage_class)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'photos.not_archived',
    })
  }

  const alreadyRestored = !status.ongoing && status.expires_at !== null && status.expires_at.getTime() > Date.now()

  if (!status.ongoing && !alreadyRestored)
    await restoreObject(awsCredentials, photo.key)

  return prisma.photo.update({
    where: { id: photo.id },
    data: {
      storage_class: status.storage_class,
      restore_ongoing: !alreadyRestored,
      restore_expires_at: alreadyRestored ? status.expires_at : null,
    },
    include: { likes: { select: { id: true } } },
  })
}
