<script setup lang="ts">
import type { AlbumSummary } from '~/composables/useAlbums'

definePageMeta({ middleware: ['auth'] })

const { albums, hasMore, loading, fetchNextPage, searchAlbums } = useAlbums()
const { addError } = useAlerts()
const { translateError } = useErrorMessage()

const sentinel = ref<HTMLElement | null>(null)
const query = ref('')
const searchResults = ref<AlbumSummary[] | null>(null)
const searching = ref(false)

const displayedAlbums = computed(() => searchResults.value ?? albums.value)

function formatDate(date: string) {
  return new Date(date).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
}

let searchDebounce: ReturnType<typeof setTimeout> | undefined

async function runSearch(keyword: string) {
  searching.value = true
  try {
    searchResults.value = await searchAlbums(keyword)
  }
  catch (error) {
    addError(translateError(error))
  }
  finally {
    searching.value = false
  }
}

watch(query, (value) => {
  clearTimeout(searchDebounce)

  if (!value.trim()) {
    searchResults.value = null
    return
  }

  searchDebounce = setTimeout(() => runSearch(value.trim()), 300)
})

let observer: IntersectionObserver | null = null

onMounted(async () => {
  await fetchNextPage()

  observer = new IntersectionObserver((entries) => {
    if (entries[0]?.isIntersecting && !searchResults.value && hasMore.value && !loading.value)
      fetchNextPage()
  })
  if (sentinel.value)
    observer.observe(sentinel.value)
})

onUnmounted(() => {
  observer?.disconnect()
})
</script>

<template>
  <div class="mx-auto flex max-w-5xl flex-col gap-y-8 py-10">
    <div class="flex items-center justify-between">
      <h1 class="text-xl font-semibold">
        Albums
      </h1>

      <NuxtLink
        to="/albums/new"
        class="flex h-10 items-center gap-x-2 rounded bg-green-500 px-4 font-medium text-white hover:bg-green-600"
      >
        <Icon name="ph:plus" size="1.1em" />
        New album
      </NuxtLink>
    </div>

    <label class="flex w-full flex-col gap-y-1">
      <span class="sr-only">Search albums</span>
      <input
        v-model="query"
        type="search"
        placeholder="Search albums…"
        class="h-10 w-full rounded border-none bg-white px-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 dark:bg-slate-700"
      >
    </label>

    <div v-if="!displayedAlbums.length && !loading && !searching" class="py-20 text-center text-slate-500 dark:text-slate-300">
      <p v-if="searchResults">
        No albums match your search.
      </p>
      <p v-else>
        You don't have any albums yet — create your first one to get started.
      </p>
    </div>

    <div class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
      <NuxtLink
        v-for="album in displayedAlbums"
        :key="album.id"
        :to="`/albums/${album.id}`"
        class="flex flex-col gap-y-2 overflow-hidden rounded"
      >
        <div class="aspect-square overflow-hidden rounded bg-slate-200 dark:bg-slate-700">
          <img v-if="album.cover" :src="album.cover" :alt="album.title ?? 'Album cover'" class="h-full w-full object-cover">
          <div v-else class="flex h-full w-full items-center justify-center text-slate-400">
            <Icon name="ph:image" size="2em" />
          </div>
        </div>
        <div class="flex flex-col">
          <span class="truncate font-medium">{{ album.title }}</span>
          <span class="text-xs text-slate-500 dark:text-slate-300">{{ formatDate(album.created_at) }}</span>
        </div>
      </NuxtLink>
    </div>

    <div ref="sentinel" class="h-4" />
    <p v-if="loading" class="text-center text-sm text-slate-500 dark:text-slate-300">
      Loading…
    </p>
  </div>
</template>
