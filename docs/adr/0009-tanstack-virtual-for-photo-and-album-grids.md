# TanStack Virtual for photo and album grids

`#130` originally deferred virtualizing the photo library page pending evidence of a real
problem; that deferral is reversed — every `BaseInfiniteScroll` consumer (the photo library,
album detail, public album share, the user's albums list, and the two photo/album picker
modals — 6 spots total) grows an ever-larger in-memory list and mounts one live DOM node per
item with no windowing, which doesn't scale.

We picked **`@tanstack/vue-virtual`** over `vue-virtual-scroller`, the other actively-maintained
Vue 3 option. `vue-virtual-scroller`'s `gridItems` mode is more turnkey but positions cells via
inline absolute positioning rather than real `display: grid`, and doesn't have a documented way
to combine grouped/sectioned content with grid mode — the photo library's date-grouped sections
need exactly that. TanStack Virtual is headless: we keep real CSS Grid markup (Tailwind
`grid-cols-*`) for the actual item layout and full control over how date groups render, at the
cost of writing our own row-chunking and column-count tracking (a shared `useVirtualGrid`
composable, reused by a thin `BaseVirtualGrid.vue` for the 5 flat cases; the grouped photo
library builds its own wrapper directly on the composable).

Column count can no longer be pure-CSS/media-query driven — the virtualizer needs to know items
per row (and item size) to compute offsets. We track it via a `ResizeObserver` on each grid
container's own rendered width (not viewport breakpoints), which is the one mechanism that's
correct for both the full-width pages and the two width-capped modals. Item size is fixed/
uniform in all 6 cases (`aspect-square` cells throughout), so no dynamic-height measurement is
needed. `BaseInfiniteScroll.vue`'s DOM-sentinel `IntersectionObserver` trigger is replaced by an
index-based "near the end of what's loaded" check inside the composable, since most items are
never mounted; `BaseInfiniteScroll.vue` is deleted once migration is complete (zero remaining
callers).
