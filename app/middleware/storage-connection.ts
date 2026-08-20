// requiresStorageConnection route guard (issue #49): redirects signed-in
// Users without a Storage Connection to the onboarding screen, and lets
// Users who already have one through. Meant to be combined with the `auth`
// middleware (e.g. `middleware: ['auth', 'storage-connection']`) on pages
// that need Photos/Albums, since it assumes the User is already known.
export default defineNuxtRouteMiddleware(async () => {
  const { user, isAuthenticated, fetchCurrentUser } = useCurrentUser()

  if (!isAuthenticated.value)
    await fetchCurrentUser()

  if (isAuthenticated.value && !user.value?.has_aws_credentials)
    return navigateTo('/storage-connection')
})
