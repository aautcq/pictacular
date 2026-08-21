# Adopt `@nuxtjs/i18n`, with local-scope per-component `<i18n>` blocks and API error codes folded into the same message tree

Status: accepted

The client had no i18n layer: all copy was hardcoded English in templates, and API error
codes (`auth.invalid_credentials`, etc. — see ADR 0001) were translated via a hand-rolled
`Record<string, string>` map in `app/utils/error-message.ts`. We're adopting `@nuxtjs/i18n`
(the official Nuxt wrapper around `vue-i18n`) rather than wiring `vue-i18n` +
`@intlify/unplugin-vue-i18n` manually, since the project already leans on official Nuxt
modules elsewhere and it still supports per-component `<i18n>` custom blocks.

Locale strategy: English only for now (`en`), no URL locale prefix (this is a
single-locale-per-session PWA gallery, not an SEO-driven multi-market site — a visible
`/fr/`-style prefix on every route would complicate the PWA `start_url`/manifest for no
current benefit), with the active locale persisted in a cookie rather than `localStorage`
so SSR renders the correct locale on first paint, consistent with the app's existing
cookie-based JWT auth.

Global strings and per-component strings both live under `<i18n>`/locale JSON, but at
different scopes:

- `app/i18n/locales/en.json` holds two top-level keys: `common` (shared strings — buttons,
  generic labels) and `errors` (the folded-in API error-code messages, keyed exactly as the
  backend's namespaced codes, e.g. `errors["auth.invalid_credentials"]`).
- Each component's own `<i18n>` block uses vue-i18n's **local scope** (the Composition API
  default for `useI18n()`) — its keys are isolated from every other component's block, so
  e.g. `login.vue` and `register.vue` can both use a key like `title` without collision.
  vue-i18n's default `fallbackRoot` behavior means the same `t()` call still reaches the
  global `common`/`errors` namespace for shared/error strings. Keys inside a component's
  block are flat/short (`title`, not `loginTitle`) since the component boundary is already
  the namespace.

`app/utils/error-message.ts` becomes a `useErrorMessage()` composable: the three exported
functions (`getErrorCode`, `translateErrorCode`, `translateError`) keep their existing
signatures and call sites, but resolve messages via `errors.*` through vue-i18n instead of
the hardcoded map.

This is a full migration of every existing hardcoded string across all pages/components in
one pass, not a partial/reference migration — done in the same change as the infra setup.
This ADR covers the whole `@nuxtjs/i18n` adoption (parent issue #89); the foundational
ticket (#91) lands only the module, the global `errors` namespace, and `useErrorMessage()`
— the per-component `<i18n>` blocks and `common` string migration described above are
follow-up tickets under #89, not part of this diff.

## Consequences

- Rendered English output must stay byte-identical to today's text: several
  `test/e2e/*.browser.test.ts` Playwright tests assert on exact strings via
  `getByText`/`getByRole({ name: ... })` (e.g. `'Sign in'`,
  `'Your photo library is empty'`). The migration is a like-for-like move of literal
  strings into locale JSON, not a copy rewrite.
- This only covers client-rendered, browser-facing copy. Transactional email content
  (verification, password reset) already has its own minimal `t(key, lang)` dictionary
  util per ADR 0001, scoped to `ejs` templates server-side — that's unrelated and unchanged
  by this decision.
- Adding a second locale later means: adding `app/i18n/locales/fr.json` (mirroring the
  `common`/`errors` keys) plus a French `<i18n>` block per component, and revisiting whether
  a locale switcher UI is needed (out of scope while `en` is the only locale).

## Considered alternatives

- **Manual `vue-i18n` + `@intlify/unplugin-vue-i18n`** instead of `@nuxtjs/i18n`: rejected —
  more setup for the same SFC-block capability, and inconsistent with how every other
  cross-cutting client concern (icons, color mode, PWA) is already a Nuxt module here.
  Note: `@nuxtjs/i18n` uses `vue-i18n` and that plugin internally, so the underlying
  mechanics are the same either way.
- **URL locale prefix** (`/fr/albums`): rejected — no SEO/multi-market need yet, and it
  complicates the PWA's `start_url` and manifest for a benefit this app doesn't have.
- **Global vue-i18n scope for component blocks** (all keys merged into one flat namespace):
  rejected — would require manually prefixing every key per file (`login.title`,
  `register.title`, ...) to avoid collisions across ~20 components; local scope gets that
  isolation for free.
- **`useErrorMessage()` as a composable rebuilding `error-message.ts` from scratch** with a
  different API shape: rejected in favor of keeping the existing three-function signature,
  so none of the ~12 existing call sites (`translateError(error)` in pages) need to change
  beyond the import.
