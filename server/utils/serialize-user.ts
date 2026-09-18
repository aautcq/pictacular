import type { AwsCredentials } from './storage'
import { generateSecureObjectUrl } from './storage'

export interface SerializableUser {
  id: number
  email: string
  first_name: string
  last_name: string
  created_at: Date
  last_sign_in_at: Date | null
  avatar_url: string | null
  aws_credentials: (AwsCredentials & { broken: boolean }) | null
}

// Shared response shape for every endpoint that returns a User's own
// profile (login, biometrics login, GET /me, avatar upload): swaps the
// raw `avatar_url` object key for a signed URL (only resolvable when a
// Storage Connection exists) and flags `has_aws_credentials`, so all four
// call sites stay in sync instead of re-deriving this shape independently.
// Also flags `storage_connection_broken` (issue #153), so the frontend
// can react to a hard-blocked connection the same way it already reacts
// to having none at all (see app/middleware/storage-connection.ts).
export async function serializeUser(user: SerializableUser) {
  const { aws_credentials, avatar_url, ...profile } = user

  // A broken connection's Role can no longer be assumed at all, so
  // signing a URL against it would only throw — this response must still
  // succeed (the User needs to see their own broken-connection state to
  // reconnect in the first place), just without a resolvable avatar.
  let signedAvatarUrl = null
  if (avatar_url && aws_credentials && !aws_credentials.broken)
    signedAvatarUrl = await generateSecureObjectUrl(aws_credentials, avatar_url)

  return {
    ...profile,
    has_aws_credentials: !!aws_credentials,
    storage_connection_broken: aws_credentials?.broken ?? false,
    avatar_url: signedAvatarUrl,
  }
}
