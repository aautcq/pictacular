// Only these two S3 storage classes make a Photo an Archived Photo (issue
// #145 / ADR 0005): `GLACIER_IR` reads instantly (no restore needed), and
// Intelligent-Tiering's archive tiers aren't visible on the free
// `ListObjectsV2` `StorageClass` field this app relies on — both
// deliberately out of scope for this iteration.
export const archivedStorageClasses = ['GLACIER', 'DEEP_ARCHIVE'] as const
const archivedStorageClassSet = new Set<string>(archivedStorageClasses)

export type PhotoArchiveState = 'archived' | 'restoring' | 'restored' | null

export interface PhotoArchiveFields {
  storage_class: string | null
  restore_ongoing: boolean
  restore_expires_at: Date | null
}

// Derives a Photo's user-facing archive state from its persisted fields
// (never a live AWS call — see server/tasks/archived-photos/scan.ts),
// mirroring the CONTEXT.md "Archived Photo" / "Restore Request" glossary:
// `null` for an ordinary (non-archived) Photo, `archived` for one that
// needs a Restore Request, `restoring` while one is in flight, and
// `restored` during its temporary availability window.
export function photoArchiveState(photo: PhotoArchiveFields): PhotoArchiveState {
  if (!photo.storage_class || !archivedStorageClassSet.has(photo.storage_class))
    return null

  if (photo.restore_ongoing)
    return 'restoring'

  if (photo.restore_expires_at && photo.restore_expires_at.getTime() > Date.now())
    return 'restored'

  return 'archived'
}

export function isArchivedStorageClass(storageClass: string | null | undefined): boolean {
  return !!storageClass && archivedStorageClassSet.has(storageClass)
}
