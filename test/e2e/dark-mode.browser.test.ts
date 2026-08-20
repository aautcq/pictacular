import { createPage, setup } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'

// Browser-driven test for issue #73: verifies the header's dark-mode toggle
// still flips the `dark` class on `<html>` and updates the aria-label, now
// that @nuxtjs/color-mode drives the behavior instead of the hand-rolled
// useDarkMode composable.
describe('dark mode toggle', async () => {
  await setup({ browser: true })

  it('flips the dark class on <html> and updates the aria-label', async () => {
    const page = await createPage('/')

    const toggle = page.getByRole('button', { name: /Switch to (dark|light) mode/ })
    const initiallyDark = await page.evaluate(() => document.documentElement.classList.contains('dark'))

    await toggle.click()

    await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(!initiallyDark)
    expect(await toggle.getAttribute('aria-label')).toBe(initiallyDark ? 'Switch to dark mode' : 'Switch to light mode')

    await toggle.click()

    await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(initiallyDark)
  })
})
