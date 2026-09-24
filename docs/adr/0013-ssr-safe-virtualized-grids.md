# SSR-safe virtualized grids

ADR 0009's `useVirtualGrid`/`BaseVirtualGrid` rollout shipped without accounting for SSR, and
every one of its 6 consumers hit a hydration mismatch on a full page load: the server always
rendered a `0px`-tall container with zero row elements, while the client's first render already
disagreed. Root cause turned out to be two distinct bugs, one universal and one incidental.

The universal cause is `@tanstack/virtual-core` itself: its range calculation returns no visible
items whenever the measured scroll-container/viewport size is `0`, which is always true
server-side — there is no real viewport to measure during SSR, by design, for any windowing
library. This means TanStack Virtual can never render real row content on the server; the best
any consumer can do is agree with the server that there's nothing to render yet. A secondary,
narrower bug hit `index.vue` specifically (the one page that builds `useVirtualGrid` directly
rather than through `BaseVirtualGrid`, per ADR 0009): `@tanstack/vue-virtual` syncs reactive
options into its internal (non-reactive) core via a `watch(..., { immediate: true })` whose
non-immediate re-fires depend on Vue's reactive job queue, which Vue's SSR renderer never
flushes — so a virtualizer constructed before its surrounding async data resolves gets its
`count`/`totalSize` frozen at whatever was true at construction time (`0`), even once the
component's own reactive state is correct by render time.

We fixed both from inside `useVirtualGrid` alone, with no changes to any of the 6 consumers.
`virtualRows` now returns `[]` until an `onMounted` flag flips, making "no rows yet" explicit and
consistent between the server's render and the client's pre-mount hydrate-compare render (real
row DOM appears immediately after mount, same as before). `totalSize` is now computed by summing
`estimateSize(index)` across the known row count directly, instead of delegating to the
virtualizer's own `getTotalSize()` — decoupling the container's height (which every consumer's
reactive state can already answer correctly pre-mount) from the internal core's freeze bug. The
container's real total height is therefore correct from the very first server-rendered byte
(no layout shift once content appears), while row content is deliberately deferred to
post-mount. Regression coverage lives in
`test/e2e/virtualized-grid-hydration.browser.test.ts`, asserting zero hydration console warnings
on a full authenticated page load of both a direct `useVirtualGrid` consumer (photo library) and
a `BaseVirtualGrid` consumer (albums list).

We considered VueUse's `provideSSRWidth`/`useSSRWidth` convention (an app-wide injected
SSR-time-width value) and per-consumer `v-if="mounted"` template guards; both were rejected in
favor of the single shared-composable fix above, since it requires zero changes at any of the 6
call sites and doesn't introduce a new app-wide convention for a problem that, on inspection, was
fully containable inside `useVirtualGrid`.
