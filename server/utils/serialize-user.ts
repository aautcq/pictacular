import type { StorageConnectionAccess } from './storage'
import { generateSecureObjectUrl } from './storage'

export interface SerializableUser {
  id: number
  email: string
  first_name: string
  last_name: string
  created_at: Date
  last_sign_in_at: Date | null
  avatar_url: string | null
  storage_connection: (StorageConnectionAccess & { broken: boolean }) | null
}

// Shared response shape for every endpoint that returns a User's own
// profile (login, biometrics login, GET /me, avatar upload): swaps the
// raw `avatar_url` object key for a signed URL (only resolvable when a
// Storage Connection exists) and flags `has_storage_connection`, so all four
// call sites stay in sync instead of re-deriving this shape independently.
// Also flags `storage_connection_broken` (issue #153), so the frontend
// can react to a hard-blocked connection the same way it already reacts
// to having none at all (see app/middleware/storage-connection.ts).
export async function serializeUser(user: SerializableUser) {
  const { storage_connection, avatar_url, ...profile } = user

  // A broken connection's Role can no longer be assumed at all, so
  // signing a URL against it would only throw — this response must still
  // succeed (the User needs to see their own broken-connection state to
  // reconnect in the first place), just without a resolvable avatar.
  let signedAvatarUrl = null
  if (avatar_url && storage_connection && !storage_connection.broken)
    signedAvatarUrl = await generateSecureObjectUrl(storage_connection, avatar_url)

  return {
    ...profile,
    has_storage_connection: !!storage_connection,
    storage_connection_broken: storage_connection?.broken ?? false,
    avatar_url: signedAvatarUrl,
  }
}
