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
