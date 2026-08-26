import { createPage, setup } from '@nuxt/test-utils/e2e'
import { describe, it } from 'vitest'

// Browser-driven test for issue #91: proves the useErrorMessage() ->
// errors.* -> vue-i18n t() wiring works end-to-end by triggering a real API
// error (an invalid login attempt) and asserting the translated message
// from app/i18n/locales/en.json (see ADR 0002) renders in the alert toast.
describe('i18n-backed API error messages', async () => {
  await setup({ browser: true })

  it('renders the translated message for an invalid-credentials error', async () => {
    const page = await createPage('/login')

    await page.getByLabel('Email').fill('nobody-i18n-test@example.com')
    await page.getByLabel('Password').fill('WrongPassword1!')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()

    await page.locator('[data-slot="title"]').getByText('Incorrect email or password.').waitFor()

    await page.close()
  })
})
