import type { AwsCredentials } from './storage'
import { generateSecureObjectUrl } from './storage'

export interface SerializablePhoto {
  id: number
  key: string
  mime_type: string
  size: number
  last_modified: Date
  created_at: Date
  likes: { id: number }[]
}

// Shared response shape for every endpoint that returns a Photo (list,
// create, like/unlike): swaps the raw storage `key` for a signed URL
// (reusing the same signed-URL helper avatars use — it's already generic
// over bucket + key) and flags whether the requesting User has liked it.
export async function serializePhoto(photo: SerializablePhoto, awsCredentials: AwsCredentials, currentUserId: number) {
  const { key, likes, ...rest } = photo

  return {
    ...rest,
    url: await generateSecureObjectUrl(awsCredentials, key),
    liked: likes.some(user => user.id === currentUserId),
  }
}
