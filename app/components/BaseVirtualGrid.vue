<script setup lang="ts" generic="T">
import type { GridColumnBreakpoint } from '~/composables/useVirtualGrid'

// Thin wrapper around `useVirtualGrid` (issue #175) for the 5 flat-list
// `BaseInfiniteScroll` consumers — the grouped photo library (`index.vue`)
// builds its own wrapper directly on the composable instead, since its rows
// interleave date-group headers with photo rows rather than a single
// uniform row height.
//
// `root` mirrors `BaseInfiniteScroll`'s own prop: pass the modal's own
// `overflow-y-auto` element for the 2 fixed-height picker grids, alongside
// `scroll-container`, so this virtualizes against that element's own
// scroll position rather than the window's. `root`'s value transitions
// from `null` to the real element right after mount (the template ref it
// comes from isn't set until then), so `scrollContainer` is a separate,
// always-stable prop rather than something inferred from `root`'s
// truthiness — inferring it that way would permanently lock in "window"
// mode for every container-scroll caller, since `root` is still `null`
// the first time this component's setup runs.
//
// `extraItemHeight` accounts for cells that render more than just a square
// `aspect-square` image — the two Album-tile grids (`albums/index.vue`,
// `AddToAlbumModal.vue`) also render a title/metadata text block *below*
// the cover image, which the default `columnWidth + gap` row-height
// estimate (correct for every plain-photo grid) doesn't leave room for;
// without it, rows are estimated shorter than they really render and the
// next absolutely-positioned row overlaps the previous one's text.
const { items, itemKey, hasMore, loading, breakpoints, gap = 8, root, scrollContainer = false, extraItemHeight = 0 } = defineProps<{
  items: T[]
  itemKey: (item: T) => string | number
  hasMore: boolean
  loading: boolean
  breakpoints: GridColumnBreakpoint[]
  gap?: number
  root?: HTMLElement | null
  scrollContainer?: boolean
  extraItemHeight?: number
}>()
const emit = defineEmits<{ loadMore: [] }>()

const container = useTemplateRef<HTMLElement | null>('container')
const scrollElement = computed(() => root ?? null)

const { columnCount, virtualRows, totalSize } = useVirtualGrid({
  container,
  scrollElement: scrollContainer ? scrollElement : undefined,
  breakpoints,
  gap,
  rowCount: columnCount => Math.ceil(items.length / columnCount),
  rowHeight: (_index, _columnCount, columnWidth) => columnWidth + extraItemHeight + gap,
  hasMore: computed(() => hasMore),
  loading: computed(() => loading),
  onLoadMore: () => emit('loadMore'),
})

function rowItems(rowIndex: number) {
  return items.slice(rowIndex * columnCount.value, rowIndex * columnCount.value + columnCount.value)
}
</script>

<template>
  <div ref="container" class="relative w-full" :style="{ height: `${totalSize}px` }">
    <div
      v-for="row in virtualRows"
      :key="row.index"
      class="absolute left-0 top-0 grid w-full"
      :style="{ transform: `translateY(${row.start}px)`, gridTemplateColumns: `repeat(${columnCount}, 1fr)`, gap: `${gap}px` }"
    >
      <slot v-for="item in rowItems(row.index)" :key="itemKey(item)" :item="item" />
    </div>
  </div>
  <p v-if="loading" class="py-4 text-center">
    <slot name="loading" />
  </p>
</template>
