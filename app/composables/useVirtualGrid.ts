import { useVirtualizer, useWindowVirtualizer } from '@tanstack/vue-virtual'

// Shared virtualization primitive for every `BaseInfiniteScroll` consumer
// (issue #175, see docs/adr/0009-tanstack-virtual-for-photo-and-album-grids.md):
// a uniform-height CSS Grid of square cells, windowed via `@tanstack/vue-virtual`
// so only the rows near the viewport (or, for the two picker modals, near the
// scrollable container) ever mount real DOM nodes.
//
// Column count can no longer be pure-CSS/media-query driven once rows are
// absolutely positioned by pixel offset — the virtualizer needs to know how
// many cells sit on each row (and how tall a row is) to compute those
// offsets. `useGridColumns` tracks it via a `ResizeObserver` on the grid
// container's own rendered width (never `window`'s), which is the one
// mechanism that's correct both for the 4 full-width pages and the 2
// width-capped modals — the pixel thresholds below are the same values
// each page's previous `sm:`/`md:` Tailwind classes encoded, just measured
// against the container instead of the viewport.
export interface GridColumnBreakpoint {
  /** Minimum container width (px) at which `columns` applies. The first entry must be `0`. */
  minWidth: number
  columns: number
}

export function useGridColumns(container: Ref<HTMLElement | null | undefined>, breakpoints: GridColumnBreakpoint[], gap = 8) {
  const sortedBreakpoints = [...breakpoints].sort((a, b) => a.minWidth - b.minWidth)
  const containerWidth = shallowRef(0)

  useResizeObserver(container, ([entry]) => {
    containerWidth.value = entry?.contentRect.width ?? 0
  })

  const columnCount = computed(() => {
    let columns = sortedBreakpoints[0]?.columns ?? 1
    for (const breakpoint of sortedBreakpoints) {
      if (containerWidth.value >= breakpoint.minWidth)
        columns = breakpoint.columns
    }
    return columns
  })

  const columnWidth = computed(() => {
    if (!containerWidth.value || columnCount.value < 1)
      return 0
    return (containerWidth.value - gap * (columnCount.value - 1)) / columnCount.value
  })

  return { columnCount, columnWidth }
}

export interface UseVirtualGridOptions {
  /** The grid's own scrolling/measurement boundary (its rendered width drives column count). */
  container: Ref<HTMLElement | null | undefined>
  /**
   * The scrollable ancestor to observe for the virtualizer's own scroll position.
   * Omit for the 4 page-level grids (they scroll the window); pass the
   * fixed-height `overflow-y-auto` element for the 2 modal grids.
   */
  scrollElement?: Ref<HTMLElement | null | undefined>
  breakpoints: GridColumnBreakpoint[]
  /** Pixel gap between both rows and columns (matches the grid's Tailwind `gap-*`). Default `8` (`gap-2`). */
  gap?: number
  /**
   * Rows to render outside the visible range on either side. Defaults to
   * however many rows fit in one viewport's height (see the `overscan`
   * computation below) so that scrolling one screen down and back never
   * unmounts a row's images — pass a fixed number to override that.
   */
  overscan?: number
  /** Row count as a function of the current column count (e.g. `Math.ceil(itemCount / columnCount)`). */
  rowCount: (columnCount: number) => number
  /** Row height (px) for a given row index. Receives the current column count/width to size uniform photo/album rows. */
  rowHeight: (index: number, columnCount: number, columnWidth: number) => number
  hasMore?: Ref<boolean>
  loading?: Ref<boolean>
  /** Rows remaining before the end of what's loaded at which `onLoadMore` fires. Default `2`. */
  nearEndRows?: number
  onLoadMore: () => void
}

// Replaces `BaseInfiniteScroll`'s DOM-sentinel `IntersectionObserver` trigger:
// virtualization means most rows are never mounted, so a sentinel element at
// the end of the list doesn't reliably exist to observe. Instead, this walks
// the virtualizer's own currently-rendered range and fires `onLoadMore` once
// the highest rendered row index gets within `nearEndRows` of the last known
// row — an index-based check rather than a DOM-visibility one. Pagination
// itself (the network/cursor layer) is unchanged; this only decides when to
// ask for the next page.
export function useVirtualGrid(options: UseVirtualGridOptions) {
  const { container, scrollElement, breakpoints, gap = 8, overscan: fixedOverscan, rowCount, rowHeight, hasMore, loading, nearEndRows = 2, onLoadMore } = options

  const { columnCount, columnWidth } = useGridColumns(container, breakpoints, gap)

  const rowCountValue = computed(() => rowCount(columnCount.value))
  const estimateSize = (index: number) => rowHeight(index, columnCount.value, columnWidth.value)

  // A fixed row-count `overscan` (the previous default, 3) shrinks in
  // effective *distance* as columns/row-height change, so a "scroll one
  // screen down, then back up" that stayed within 3 rows on a narrow,
  // many-column grid could still unmount rows on a wider one. Sizing it to
  // however many rows fit in one viewport's height instead keeps that
  // guarantee independent of column count (issue #178) — measured against
  // the scrollable element's own height for the 2 modal grids, or the
  // window's for the 4 page-level ones.
  const viewportHeight = scrollElement
    ? useElementSize(scrollElement).height
    : useWindowSize().height
  const overscan = computed(() => {
    if (fixedOverscan !== undefined)
      return fixedOverscan

    const estimatedRowHeight = estimateSize(0)
    // `useWindowSize()` reports `Infinity` for its `height` until it mounts
    // client-side (there's no `window` during SSR to measure), so the 4
    // page-level grids would otherwise compute an `Infinity` overscan on
    // the server and render every row unbounded — falling back to the
    // fixed default here until a real, finite height is available avoids
    // reintroducing the unbounded-DOM problem virtualization exists to fix.
    if (!estimatedRowHeight || !Number.isFinite(viewportHeight.value))
      return 3

    return Math.max(1, Math.ceil(viewportHeight.value / estimatedRowHeight))
  })

  // The window virtualizer positions rows relative to the *document*, not
  // the grid container, so it needs to know how far down the page the
  // container itself starts (`scrollMargin`) to translate its own
  // document-relative offsets back into container-relative ones for
  // rendering. A `ResizeObserver` on the container alone only fires when
  // the container's *own* box changes — not when content reflows above it
  // without resizing the container itself (e.g. an album's editable title
  // switching between a `<button>` and an `<input>`, or its description
  // between a truncated `<button>` and a multi-row `<textarea>`) — so a
  // `MutationObserver` on the whole document also re-measures on any DOM
  // change, catching those upstream reflows too.
  const scrollMargin = shallowRef(0)
  function measureScrollMargin() {
    if (container.value)
      scrollMargin.value = container.value.getBoundingClientRect().top + window.scrollY
  }
  useResizeObserver(container, measureScrollMargin)
  useMutationObserver(() => (import.meta.client ? document.body : null), measureScrollMargin, { childList: true, subtree: true })

  const virtualizer = scrollElement
    ? useVirtualizer(computed(() => ({
        count: rowCountValue.value,
        estimateSize,
        overscan: overscan.value,
        getScrollElement: () => scrollElement.value ?? null,
      })))
    : useWindowVirtualizer(computed(() => ({
        count: rowCountValue.value,
        estimateSize,
        overscan: overscan.value,
        scrollMargin: scrollMargin.value,
      })))

  const virtualRows = computed(() => virtualizer.value.getVirtualItems().map(row => ({
    ...row,
    start: row.start - (scrollElement ? 0 : scrollMargin.value),
  })))

  const totalSize = computed(() => virtualizer.value.getTotalSize())

  watch(virtualRows, (rows) => {
    if (!hasMore?.value || loading?.value)
      return

    const lastRenderedIndex = rows.at(-1)?.index ?? -1
    if (lastRenderedIndex >= rowCountValue.value - 1 - nearEndRows)
      onLoadMore()
  })

  return { columnCount, columnWidth, rowCount: rowCountValue, virtualRows, totalSize }
}
