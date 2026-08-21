import { $fetch, setup } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'
import { prisma } from '../../server/utils/prisma'

// Black-box HTTP test for the global API error logger (issue #56): every
// thrown/handled API error must be persisted to the ApiError table (path,
// status, message, and the requesting User/IP when known) without altering
// the existing namespaced error-code response contract.
describe('api error logging', async () => {
  await setup()

  it('persists an ApiError row when a known error is thrown (invalid login)', async () => {
    const email = `unknown-${Date.now()}@example.com`

    await expect(
      $fetch('/api/auth/sessions', { method: 'POST', body: { email, password: 'wrong-password' } }),
    ).rejects.toMatchObject({ statusCode: 401, statusMessage: 'auth.invalid_credentials' })

    const apiError = await prisma.apiError.findFirst({
      where: { path: '/api/auth/sessions', status: 401 },
      orderBy: { created_at: 'desc' },
    })

    expect(apiError).toMatchObject({
      path: '/api/auth/sessions',
      status: 401,
      type: 'API',
      message: 'auth.invalid_credentials',
      user_id: null,
    })
    expect(apiError?.user_ip).toBeTruthy()
  })
})
