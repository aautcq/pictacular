import type { AwsCredentials } from './storage'
import { photoArchiveState } from './archived-photo'
import { generateSecureObjectUrl } from './storage'

export interface SerializablePhoto {
  id: number
  key: string
  mime_type: string
  size: number
  last_modified: Date
  created_at: Date
  likes: { id: number }[]
  storage_class: string | null
  restore_ongoing: boolean
  restore_expires_at: Date | null
}

// Shared response shape for every endpoint that returns a Photo (list,
// create, like/unlike, restore): swaps the raw storage `key` for a signed
// URL (reusing the same signed-URL helper avatars use — it's already
// generic over bucket + key), flags whether the requesting User has liked
// it, and replaces the raw persisted storage-class/restore-status fields
// (issue #145) with a single derived `archived_state` (see
// server/utils/archived-photo.ts) plus the restore's expiry, so the
// client never needs to reimplement that derivation itself.
export async function serializePhoto(photo: SerializablePhoto, awsCredentials: AwsCredentials, currentUserId: number) {
  const { key, likes, storage_class, restore_ongoing, restore_expires_at, ...rest } = photo

  return {
    ...rest,
    url: await generateSecureObjectUrl(awsCredentials, key),
    liked: likes.some(user => user.id === currentUserId),
    archived_state: photoArchiveState({ storage_class, restore_ongoing, restore_expires_at }),
    restore_expires_at,
  }
}
