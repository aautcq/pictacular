import { photoArchiveState } from './archived-photo'

export interface SerializablePhoto {
  id: number
  key: string
  mime_type: string
  size: number
  last_modified: Date
  taken_at: Date | null
  created_at: Date
  likes: { id: number }[]
  storage_class: string | null
  restore_ongoing: boolean
  restore_expires_at: Date | null
}

// A freshly-uploaded Photo's key is `photos/<userId>/<uuid>-<filename>`
// (see uploadPhotoObject in storage.ts), but an imported Photo's key is
// whatever key the object already had in the User's bucket (issue #54),
// with no such prefix at all — so the UUID prefix is only ever stripped
// when it's actually there, rather than assumed.
const uuidKeyPrefixPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i

function filenameFromKey(key: string): string {
  const lastSegment = key.split('/').pop() ?? key
  return lastSegment.replace(uuidKeyPrefixPattern, '')
}

// This app's own stable, per-Photo image endpoint (issue #168): unlike
// the presigned S3 URL it replaces, this URL never changes/expires, so it
// can actually be cached (by the browser, and by @nuxt/image's IPX layer,
// which resizes/transcodes on demand — see BaseImg.vue). Authorization
// (owner, or an Album Collaborator via a shared Album) happens at request
// time in the route itself (see server/utils/photo-image-access.ts), not
// by embedding a capability in the URL the way the old presigned URL did.
export function photoImageUrl(photoId: number): string {
  return `/api/photos/${photoId}/image`
}

// Public Share Link counterpart of photoImageUrl (issue #168): scoped
// under the Album's own share token rather than a User session, mirroring
// the existing GET /api/albums/public/[token] route, for anonymous
// visitors who have no cookie to authenticate with at all.
export function publicPhotoImageUrl(token: string, photoId: number): string {
  return `/api/albums/public/${token}/photos/${photoId}/image`
}

// Shared response shape for every endpoint that returns a Photo (list,
// create, like/unlike, restore): swaps the raw storage `key` for this
// app's own stable image URL + the original filename derived from it,
// flags whether the requesting User has liked it, and replaces the raw
// persisted storage-class/restore-status fields (issue #145) with a
// single derived `archived_state` (see server/utils/archived-photo.ts)
// plus the restore's expiry, so the client never needs to reimplement
// that derivation itself.
export function serializePhoto(photo: SerializablePhoto, currentUserId: number) {
  const { key, likes, storage_class, restore_ongoing, restore_expires_at, ...rest } = photo

  return {
    ...rest,
    url: photoImageUrl(photo.id),
    filename: filenameFromKey(key),
    liked: likes.some(user => user.id === currentUserId),
    archived_state: photoArchiveState({ storage_class, restore_ongoing, restore_expires_at }),
    restore_expires_at,
  }
}
