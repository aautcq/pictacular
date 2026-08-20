// Keeps already-authenticated Users off the visitor-only auth screens
// (login/register/forgot-password), redirecting them to the app instead.
export default defineNuxtRouteMiddleware(async () => {
  const { isAuthenticated, fetchCurrentUser } = useCurrentUser()

  if (!isAuthenticated.value)
    await fetchCurrentUser()

  if (isAuthenticated.value)
    return navigateTo('/')
})
