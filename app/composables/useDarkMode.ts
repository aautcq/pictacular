const STORAGE_KEY = 'pictacular-theme'

// Dark-mode toggle persisted to localStorage across reloads (issue #48),
// ported from the legacy layout store. Falls back to the OS preference
// when no explicit choice has been made yet.
export function useDarkMode() {
  const isDark = useState<boolean>('dark-mode', () => false)

  function apply(dark: boolean) {
    isDark.value = dark
    if (!import.meta.client)
      return

    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem(STORAGE_KEY, dark ? 'dark' : 'light')
  }

  function init() {
    if (!import.meta.client)
      return

    const stored = localStorage.getItem(STORAGE_KEY)
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches

    if (stored === 'dark' || (stored === null && prefersDark))
      apply(true)
    else
      apply(false)
  }

  function toggle() {
    apply(!isDark.value)
  }

  return { isDark, init, toggle }
}
