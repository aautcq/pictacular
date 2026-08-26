import { createPage, setup, url } from '@nuxt/test-utils/e2e'
import { afterAll, describe, expect, it } from 'vitest'
import { hashPassword } from '../../server/utils/crypto'
import { prisma } from '../../server/utils/prisma'

// Browser-driven test for issue #73: verifies the profile page's dark-mode
// toggle still flips the `dark` class on `<html>` and updates its visible
// label, now that @nuxtjs/color-mode drives the behavior instead of the
// hand-rolled useDarkMode composable. The toggle lives on the (authenticated)
// profile page (see app/pages/profile.vue), not the public home/login page,
// so this signs in first.
describe('dark mode toggle', async () => {
  await setup({ browser: true })

  const emailPrefix = `dark-mode-${Date.now()}`
  const email = `${emailPrefix}@example.com`
  const password = 'Str0ng!Pass'

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { startsWith: emailPrefix } } })
  })

  it('flips the dark class on <html> and updates its visible label', async () => {
    await prisma.user.create({
      data: {
        email,
        first_name: 'Jane',
        last_name: 'Doe',
        password: hashPassword(password),
        is_verified: true,
        verification_token: `token-${emailPrefix}`,
      },
    })

    const page = await createPage('/login')
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password').fill(password)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.waitForURL('**/storage-connection')

    await page.goto(url('/profile'))

    const toggle = page.getByRole('button', { name: /Switch to (dark|light) mode/ })
    await toggle.waitFor()
    const initiallyDark = await page.evaluate(() => document.documentElement.classList.contains('dark'))

    await toggle.click()

    await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(!initiallyDark)
    // No explicit aria-label on this button (see app/pages/profile.vue) — its
    // accessible name comes from the visible `label` text itself.
    expect(await toggle.textContent()).toBe(initiallyDark ? 'Switch to dark mode' : 'Switch to light mode')

    await toggle.click()

    await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(initiallyDark)

    await page.close()
  }, 60_000)
})
