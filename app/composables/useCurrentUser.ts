export interface CurrentUser {
  id: number
  email: string
  first_name: string
  last_name: string
  avatar_url: string | null
  has_aws_credentials: boolean
  created_at: string
  last_sign_in_at: string | null
}

// Current-User session state (issue #48), ported from the legacy
// currentUser Pinia store as a Nuxt composable backed by useState: every
// auth screen (register/verify/login/reset-password/profile) reads and
// mutates this single shared piece of state, matching the auth cookies
// the server already issues/clears on each call.
export function useCurrentUser() {
  const user = useState<CurrentUser | null>('current-user', () => null)

  const isAuthenticated = computed(() => !!user.value)
  const fullName = computed(() => user.value ? `${user.value.first_name} ${user.value.last_name}` : '')

  async function fetchCurrentUser() {
    try {
      // Plain `$fetch` never forwards the incoming request's cookies to
      // this internal API call during SSR (the `auth` middleware runs on
      // the server too, e.g. on a hard navigation to a protected page),
      // so `useRequestFetch()` is required server-side to see the same
      // auth cookies the browser already sent.
      // With this many Nitro server routes (including issue #51's Album
      // ones), TypeScript's own recursion limit ("Excessive stack depth
      // comparing types") is hit resolving `useRequestFetch()`'s generic
      // `$Fetch` type against every registered route — a known
      // Nitro/Nuxt typed-fetch limitation (see e.g. nitrojs/nitro#470),
      // not a real type error. The explicit `<CurrentUser>` generic below
      // already gives this call its real return type.
      const requestFetch = import.meta.server ? useRequestFetch() : $fetch
      user.value = await requestFetch<CurrentUser>('/api/users/me')
    }
    catch {
      user.value = null
    }
    return user.value
  }

  async function register(payload: { email: string, first_name: string, last_name: string, password: string, password_confirmation: string }) {
    await $fetch('/api/auth/users', { method: 'POST', body: payload })
  }

  async function resendVerification(email: string) {
    await $fetch('/api/auth/verify', { method: 'POST', body: { email } })
  }

  async function verifyAccount(token: string) {
    const requestFetch = import.meta.server ? useRequestFetch() : $fetch
    await await requestFetch(`/api/auth/verify/${token}`)
  }

  async function login(email: string, password: string) {
    user.value = await $fetch<CurrentUser>('/api/auth/sessions', { method: 'POST', body: { email, password } })
    return user.value
  }

  async function loginWithBiometrics() {
    const { signIn } = useBiometrics()
    user.value = await signIn()
    return user.value
  }

  async function logout() {
    if (user.value)
      await $fetch('/api/auth/logout', { method: 'POST' })
    user.value = null
  }

  async function requestPasswordReset(email: string) {
    await $fetch('/api/auth/reset-password', { method: 'POST', body: { email } })
  }

  async function setNewPassword(token: string, password: string, password_confirmation: string) {
    await $fetch(`/api/auth/reset-password/${token}`, { method: 'POST', body: { password, password_confirmation } })
  }

  async function updateProfile(payload: Partial<Pick<CurrentUser, 'email' | 'first_name' | 'last_name'>> & { current_password?: string, password?: string, password_confirmation?: string }) {
    const updated = await $fetch<CurrentUser>('/api/users/me', { method: 'PATCH', body: payload })
    user.value = user.value ? { ...user.value, ...updated } : updated
    return user.value
  }

  async function uploadAvatar(payload: { filename: string, mime_type: string, base64: string }) {
    const updated = await $fetch<CurrentUser>('/api/users/me/avatar', { method: 'PATCH', body: payload })
    user.value = user.value ? { ...user.value, ...updated } : updated
    return user.value
  }

  async function deleteAccount() {
    await $fetch('/api/users/me', { method: 'DELETE' })
    user.value = null
  }

  async function launchStorageConnection(payload: StorageConnectionLaunchInput) {
    return await $fetch<{ launch_url: string, pending_token: string }>('/api/storage-connections/launch', { method: 'POST', body: payload })
  }

  async function confirmStorageConnection(pendingToken: string) {
    await $fetch('/api/storage-connections', { method: 'POST', body: { pending_token: pendingToken } })
    await fetchCurrentUser()
  }

  async function checkBucket() {
    const { has_photos } = await useRequestFetch()<{ has_photos: boolean }>('/api/storage-connections/check-bucket')
    return has_photos
  }

  return {
    user,
    isAuthenticated,
    fullName,
    fetchCurrentUser,
    register,
    resendVerification,
    verifyAccount,
    login,
    loginWithBiometrics,
    logout,
    requestPasswordReset,
    setNewPassword,
    updateProfile,
    uploadAvatar,
    deleteAccount,
    launchStorageConnection,
    confirmStorageConnection,
    checkBucket,
  }
}
