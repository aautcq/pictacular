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
  aws_credentials: AwsCredentials | null
}

// Shared response shape for every endpoint that returns a User's own
// profile (login, biometrics login, GET /me, avatar upload): swaps the
// raw `avatar_url` object key for a signed URL (only resolvable when a
// Storage Connection exists) and flags `has_aws_credentials`, so all four
// call sites stay in sync instead of re-deriving this shape independently.
export async function serializeUser(user: SerializableUser) {
  const { aws_credentials, avatar_url, ...profile } = user

  let signedAvatarUrl = null
  if (avatar_url && aws_credentials)
    signedAvatarUrl = await generateSecureObjectUrl(aws_credentials, avatar_url)

  return { ...profile, has_aws_credentials: !!aws_credentials, avatar_url: signedAvatarUrl }
}
