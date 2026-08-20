// requiresAuth route guard (issue #48): redirects unauthenticated Users to
// sign-in, letting authenticated Users through. Applied via
// `definePageMeta({ middleware: 'auth' })` on protected pages.
export default defineNuxtRouteMiddleware(async (to) => {
  const { isAuthenticated, fetchCurrentUser } = useCurrentUser()

  if (!isAuthenticated.value)
    await fetchCurrentUser()

  if (!isAuthenticated.value) {
    return navigateTo({ path: '/login', query: { redirect: to.fullPath } })
  }
})
