// Client-owned translation of the namespaced machine-readable error codes
// returned by the API (see server/api/**): the backend never returns
// user-facing text, only a code such as "auth.invalid_credentials".
const messages: Record<string, string> = {
  'auth.invalid_payload': 'Please check the information you entered.',
  'auth.invalid_credentials': 'Incorrect email or password.',
  'auth.email_taken': 'This email is already taken.',
  'auth.invalid_token': 'This link is invalid or has expired.',
  'auth.invalid_aws_credentials': 'Your storage connection credentials are invalid.',
  'users.invalid_payload': 'Please check the information you entered.',
  'users.storage_connection_required': 'Connect a storage bucket before uploading an avatar.',
  'storage.invalid_payload': 'Please check the information you entered.',
  'storage.invalid_credentials': 'Those AWS credentials were rejected. Double-check your access key and secret key.',
  'storage.bucket_not_found': 'That bucket could not be found or is not accessible with these credentials.',
  'storage.bucket_setup_failed': 'Something went wrong setting up your bucket. Please try again.',
  'storage.already_connected': 'You already have a storage connection.',
  'storage.connection_required': 'Connect a storage bucket first.',
  'photos.invalid_payload': 'Please check the photo you selected.',
  'photos.invalid_query': 'Something went wrong loading your photos.',
  'photos.storage_connection_required': 'Connect a storage bucket before uploading a photo.',
  'photos.not_found': 'That photo could not be found.',
  'photos.upload_failed': 'That photo could not be uploaded. Please try again.',
  'albums.invalid_payload': 'Please check the information you entered.',
  'albums.invalid_query': 'Something went wrong loading your albums.',
  'albums.not_found': 'That album could not be found.',
  'albums.admin_only': 'Only the album admin can do that.',
  'albums.photo_not_found': 'That photo could not be found.',
  'albums.cannot_remove_admin': 'The album admin cannot be removed as a collaborator.',
  'invitations.not_found': 'This invitation link is invalid or has expired.',
  'biometrics.invalid_payload': 'Please check the information you entered.',
  'biometrics.missing_challenge': 'That biometric prompt took too long. Please try again.',
  'biometrics.registration_failed': 'Your device could not register a biometric credential. Please try again.',
  'biometrics.invalid_credentials': 'That biometric credential could not be verified.',
}

export function getErrorCode(error: unknown): string {
  if (error && typeof error === 'object') {
    const withData = error as { data?: { statusMessage?: string }, statusMessage?: string }
    return withData.data?.statusMessage ?? withData.statusMessage ?? 'unknown_error'
  }
  return 'unknown_error'
}

export function translateErrorCode(code: string): string {
  return messages[code] ?? 'Something went wrong. Please try again.'
}

export function translateError(error: unknown): string {
  return translateErrorCode(getErrorCode(error))
}
