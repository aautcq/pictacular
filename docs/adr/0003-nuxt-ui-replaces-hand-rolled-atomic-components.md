# Adopt Nuxt UI, replacing every hand-rolled atomic component with `U*` primitives directly (no wrapper components)

Status: accepted

The client had accumulated a set of hand-rolled, Tailwind-styled atomic components
(`AppFormField`, `AppModal`, `AppAlerts`, `AuthCard`) plus raw `<button>`/`<input>` markup
repeated across every page (login, register, index/gallery, albums, profile, ...), all
converging on the same visual language: `green` for primary actions, `slate` for neutral
surfaces, `red` for danger. We're adopting Nuxt UI (`@nuxt/ui`) and using its `U*` components
(`UButton`, `UInput`, `UFormField`, `UModal`, `UCard`, `UToast`/`useToast`) directly at every
call site, rather than keeping a layer of `App*` wrapper components around them — the
wrappers would mostly be pure pass-through with no behavior of their own, so they'd just add
an indirection with no payoff. The two exceptions below keep behavior that Nuxt UI doesn't
provide.

Per-component decisions:

- **`AppFormField` → deleted, but its hydration-safety directive survives** as a shared
  `vHydrationSafeValue`-equivalent applied directly to each `UInput`'s exposed `inputRef`.
  This was the one piece of due diligence worth doing before committing to "no wrappers":
  `UInput` binds its underlying `<input>` via a custom `:value`/`@input` pattern (not Vue's
  `v-model`/`vModelText` directive), with no `defaultValue`-vs-live-DOM reconciliation for
  any input type. It does **not** protect against the autofill/fast-fill hydration race
  (browser autofill, or a Playwright `.fill()`, writing to the DOM before hydration
  completes) that the original directive existed to fix for `email`/`password` fields
  (issue #91). Duplicating that directive at every `UInput` call site would be a
  maintenance/bug-risk trap, so it's kept as one shared piece of logic — the only survivor
  of the "no wrappers" rule, and deliberately *not* a wrapper component.
- **`AppModal`/`useModal`/`useFocusTrap` → deleted.** `UModal` (built on Reka UI) handles
  focus-trapping internally, making the hand-rolled `useFocusTrap` fully redundant. The
  global named-modal state (`useModal('name')` backed by `useState`) is replaced by a local
  `ref` + `v-model:open` per modal instance — six instances across three pages, each now
  self-contained rather than coordinated through global state.
- **`AppAlerts`/`useAlerts` → deleted**, replaced by Nuxt UI's `useToast()` at every call
  site that previously called `addSuccess`/`addError`. Requires wrapping `app.vue` in
  `<UApp>` to provide the toast (and tooltip) context Nuxt UI needs.
- **`AuthCard` → deleted**, replaced by a `layouts/auth.vue` Nuxt layout. Unlike the others,
  it carried no behavior at all — it was reused identically across 5 auth pages purely to
  avoid literal markup duplication, which is exactly what Nuxt's own layout system is for.
- **`AppHeader` is unaffected by "no wrappers"** — it's the app's own layout chrome, not a
  generic wrapper around a single Nuxt UI primitive. Its internals (theme toggle, icon
  usage) get re-skinned with `UButton`, but the component stays.

Theming: `app.config.ts` locks in `ui.colors.primary = green`, `ui.colors.neutral = slate`,
`ui.colors.error = red` — matching the current palette exactly rather than adopting Nuxt
UI's own default shades, since this is a component-library swap, not a visual redesign.
`ui.icons.*` is set to the existing Phosphor (`ph:`) equivalents so Nuxt UI's own internal
icons (close buttons, chevrons, spinners) match the icon language already used everywhere
else via `@nuxt/icon`. `@nuxtjs/color-mode` is kept as-is; only the toggle button is
re-skinned as a `UButton`.

Button styling is locked into a single color/variant mapping table (documented for
implementers, not enforced by a wrapper component):

| Current style | Example | `UButton` props |
|---|---|---|
| `bg-green-500` solid, white text | submit/primary actions | `color="primary" variant="solid"` |
| `bg-slate-200` hover fill | secondary actions (cancel, clear selection) | `color="neutral" variant="soft"` |
| `border border-slate-300` outline | secondary alt (sign in with biometrics) | `color="neutral" variant="outline"` |
| `bg-red-500` solid, white text | destructive (delete, confirm-delete) | `color="error" variant="solid"` |
| icon-only, no bg | header/modal/lightbox icon buttons | `variant="ghost"` (+ `square` where icon-only) |
| text + underline, colored | inline text links (e.g. "select day") | `variant="link" color="primary"` |
| text + underline, no color | editable-title inline trigger | `variant="link" color="neutral"` |

Migration is phased, not a single big-bang PR: shared infra first (`app.config.ts` theming/
icons, `<UApp>` wrapping, `layouts/auth.vue`, the shared hydration-safety directive), then
pages domain-by-domain (auth pages, then index/gallery, then albums, then profile).

## Consequences

- Every page that called `addSuccess`/`addError` needs its imports/calls rewritten to
  `useToast()` — a mechanical but wide-reaching diff (this was chosen over a facade
  specifically to avoid an indirection layer, per the "no wrappers" decision).
- The six modal instances lose the global named-modal coordination `useModal` provided
  (e.g. any future cross-page "is any modal open" check would need to be re-derived, since
  state is now local per instance). None of the current usage relied on that, so this is a
  latent capability loss, not a regression today.
- Any new form field must remember to apply the shared hydration-safety directive to
  `UInput`'s exposed `inputRef` — this isn't enforced by the type system, only by
  convention, so a code-review checklist item (or lint rule) may be worth adding later if it
  gets missed in practice.

## Considered alternatives

- **Thin `App*` wrapper components around every `U*` primitive** (`AppButton`, `AppInput`,
  etc.) for a consistent repo-wide naming/import convention: rejected — most would be pure
  pass-through with no behavior, adding an indirection layer for no payoff. The two
  exceptions that do carry real behavior (hydration safety, modal focus-trapping) are
  handled by keeping the underlying logic, not by keeping a wrapper *component*.
- **`useAlerts()` as a facade over `useToast()`**, preserving the existing `addSuccess`/
  `addError` call-site API: rejected in favor of a direct rewrite, consistent with "no
  wrappers" — a facade here would be the same kind of pure pass-through being avoided
  elsewhere.
- **Keeping the global named-modal system** (`useModal('name')`) wrapping `UModal`:
  rejected — `UModal` already owns its own open/closed state idiomatically via
  `v-model:open`, and the six modal instances never needed cross-instance coordination.
- **Duplicating `AuthCard`'s markup inline across 5 auth pages**: rejected in favor of a
  Nuxt layout, which is the idiomatic Nuxt mechanism for shared page chrome and sidesteps
  the wrapper-vs-duplication question entirely.
- **Big-bang single-PR migration**: rejected — phasing shared infra first, then pages
  domain-by-domain, keeps each PR reviewable given the change spans 5 components and ~10
  pages.
