// Client-owned translation of the namespaced machine-readable error codes
// returned by the API (see server/api/**): the backend never returns
// user-facing text, only a code such as "auth.invalid_credentials". Message
// text lives in the `errors` namespace of the global locale file
// (app/i18n/locales/en.json, see ADR 0002) rather than a hardcoded map, so
// it flows through vue-i18n like every other rendered string.
export function useErrorMessage() {
  const { t, te } = useI18n({ useScope: 'global' })

  function getErrorCode(error: unknown): string {
    if (error && typeof error === 'object') {
      const withData = error as { data?: { statusMessage?: string }, statusMessage?: string }
      return withData.data?.statusMessage ?? withData.statusMessage ?? 'unknown_error'
    }
    return 'unknown_error'
  }

  function translateErrorCode(code: string): string {
    const key = `errors["${code}"]`
    return te(key) ? t(key) : t('errors["unknown_error"]')
  }

  function translateError(error: unknown): string {
    return translateErrorCode(getErrorCode(error))
  }

  // Extracts the structured per-field errors carried by the generic
  // `validation.invalid_payload` code's `data.errors` (see ADR 0004), for
  // use as a `UForm#setErrors` fallback: defense-in-depth against a form's
  // client-side `:schema` validation drifting from the server's.
  function getFieldErrors(error: unknown): { name: string, message: string }[] {
    const withData = error as { data?: { data?: { errors?: { name: string, message: string }[] } } }
    return withData.data?.data?.errors ?? []
  }

  return { getErrorCode, translateErrorCode, translateError, getFieldErrors }
}
