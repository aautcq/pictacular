// Minimal protected route demonstrating the auth-context shape end to end:
// an unauthenticated request gets a 401 (via requireAuth), a request with a
// validly-signed access-token cookie gets 200 with the context it wrote.
export default defineEventHandler((event) => {
  const { user, session } = requireAuth(event)

  return { user, session }
})
