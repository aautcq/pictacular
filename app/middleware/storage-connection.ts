// requiresStorageConnection route guard (issue #49): redirects signed-in
// Users without a Storage Connection to the onboarding screen, and lets
// Users who already have one through. Meant to be combined with the `auth`
// middleware (e.g. `middleware: ['auth', 'storage-connection']`) on pages
// that need Photos/Albums, since it assumes the User is already known.
// Also redirects a User whose connection is known to be broken (issue
// #153) the same way — every photo action is already hard-blocked
// server-side, so there's nothing useful for them to do on any of these
// pages until they relaunch the stack and reconnect via that same
// onboarding screen.
export default defineNuxtRouteMiddleware(async () => {
  const { user, isAuthenticated, fetchCurrentUser } = useCurrentUser()

  if (!isAuthenticated.value)
    await fetchCurrentUser()

  if (isAuthenticated.value && (!user.value?.has_storage_connection || user.value?.storage_connection_broken))
    return navigateTo('/storage-connection')
})
