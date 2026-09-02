<script setup lang="ts">
// Shared infinite-scroll wiring (issue #170), extracted out of
// index.vue/album/[id].vue/albums/public/[token].vue's identical
// duplicated sentinel + IntersectionObserver + loading-indicator markup:
// renders a sentinel element right after the caller's own list/grid, and
// emits `load-more` once it enters the viewport, as long as there's more
// to load and a fetch isn't already in flight. The loading indicator
// itself stays a caller-owned slot (rather than an internal prop) so each
// page keeps its own translated "Loading…" text.
//
// `root` is optional and defaults to the document viewport: pass it when
// the caller's list scrolls within its own bounded container (e.g. a
// modal grid capped with `max-h-*` + `overflow-y-auto`) rather than the
// page itself — in that case place this component as the last child
// inside that scrolling container so the sentinel is actually reachable
// by scrolling it.
const { hasMore, loading, root } = defineProps<{ hasMore: boolean, loading: boolean, root?: HTMLElement | null }>()
const emit = defineEmits<{ loadMore: [] }>()

const sentinel = useTemplateRef<HTMLElement | null>('sentinel')

useIntersectionObserver(sentinel, ([entry]) => {
  if (entry?.isIntersecting && hasMore && !loading)
    emit('loadMore')
}, { root: computed(() => root ?? null) })
</script>

<template>
  <div ref="sentinel" class="h-4" />
  <slot v-if="loading" name="loading" />
</template>
