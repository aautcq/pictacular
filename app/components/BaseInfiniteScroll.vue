<script setup lang="ts">
// Shared infinite-scroll wiring (issue #170), extracted out of
// index.vue/album/[id].vue/albums/public/[token].vue's identical
// duplicated sentinel + IntersectionObserver + loading-indicator markup:
// renders a sentinel element right after the caller's own list/grid, and
// emits `load-more` once it enters the viewport, as long as there's more
// to load and a fetch isn't already in flight. The loading indicator
// itself stays a caller-owned slot (rather than an internal prop) so each
// page keeps its own translated "Loading…" text.
const { hasMore, loading } = defineProps<{ hasMore: boolean, loading: boolean }>()
const emit = defineEmits<{ loadMore: [] }>()

const sentinel = useTemplateRef<HTMLElement | null>('sentinel')

useIntersectionObserver(sentinel, ([entry]) => {
  if (entry?.isIntersecting && hasMore && !loading)
    emit('loadMore')
})
</script>

<template>
  <div ref="sentinel" class="h-4" />
  <slot v-if="loading" name="loading" />
</template>
