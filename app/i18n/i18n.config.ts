import en from './locales/en.json'

// Global locale bundle (ADR 0002): defined here (rather than lazy-loaded
// per-locale JSON via `locales[].file`) so translations ship inline in the
// client bundle with no extra runtime fetch — the app is English-only for
// now, so there is no lazy-loading benefit to trade away.
export default defineI18nConfig(() => ({
  legacy: false,
  locale: 'en',
  messages: { en },
}))
