import { createPage, setup, url } from '@nuxt/test-utils/e2e'
import { afterAll, describe, it } from 'vitest'
import { prisma } from '../../server/utils/prisma'

// Browser-driven journey test (issue #48): a visitor registers, verifies
// their account via the emailed token link, signs in, views their
// profile, and logs out — exercising the ported auth screens end to end
// against the real booted app, per issue #46's testing decisions.
describe('register -> verify -> sign in -> profile -> logout journey', async () => {
  await setup({ browser: true })

  const emailPrefix = `journey-${Date.now()}`
  const email = `${emailPrefix}@example.com`
  const password = 'Str0ng!Pass'

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { startsWith: emailPrefix } } })
  })

  it('completes the full journey', async () => {
    const page = await createPage('/register')

    await page.getByLabel('First name').fill('Jane')
    await page.getByLabel('Last name').fill('Doe')
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password', { exact: true }).fill(password)
    await page.getByLabel('Confirm password').fill(password)
    await page.getByRole('button', { name: 'Sign up' }).click()

    await page.getByText('Check your inbox').waitFor()

    const user = await prisma.user.findUniqueOrThrow({ where: { email } })

    await page.goto(url(`/verification/${user.verification_token}`))
    await page.getByText('Your account is verified.').waitFor()

    await page.goto(url('/login'))
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password').fill(password)
    await page.getByRole('button', { name: 'Sign in' }).click()

    await page.waitForURL('**/')
    await page.getByText(`Welcome, Jane Doe`).waitFor()

    await page.goto(url('/profile'))
    await page.getByText(email).waitFor()

    await page.getByRole('button', { name: 'Log out' }).click()
    await page.waitForURL('**/login')

    await page.goto(url('/profile'))
    await page.waitForURL('**/login**')

    await page.close()
  }, 60_000)
})
