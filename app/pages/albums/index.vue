<script setup lang="ts">
import type { AlbumSummary } from '~/composables/useAlbums'
import type { GridColumnBreakpoint } from '~/composables/useVirtualGrid'

definePageMeta({ middleware: ['auth'] })

// Issue #175: the "New album" tile isn't paginated data, but it still needs
// to flow as the grid's first cell (same row as the first real Album) —
// folded into the virtualized item list as its own item type rather than
// rendered outside the grid, so `BaseVirtualGrid`'s row chunking still
// accounts for it.
type GridItem = { type: 'new-album' } | { type: 'album', album: AlbumSummary }

const breakpoints: GridColumnBreakpoint[] = [
  { minWidth: 0, columns: 2 },
  { minWidth: 640, columns: 3 },
  { minWidth: 768, columns: 4 },
]

const { albums, hasMore, loading, fetchNextPage, searchAlbums } = useAlbums()
const toast = useToast()
const { translateError } = useErrorMessage()
const { t } = useI18n({ useScope: 'local', inheritLocale: true })
const { t: tg } = useI18n({ useScope: 'global' })

const query = shallowRef('')
const debouncedQuery = refDebounced(query, 300)
const searchResults = ref<AlbumSummary[] | null>(null)
const searching = shallowRef(false)

const displayedAlbums = computed(() => searchResults.value ?? albums.value)
const gridItems = computed<GridItem[]>(() => [
  { type: 'new-album' },
  ...displayedAlbums.value.map(album => ({ type: 'album' as const, album })),
])
// Search results are fetched in full up front (see `searchAlbums`), so the
// grid never needs to page further while a search is active.
const gridHasMore = computed(() => !searchResults.value && hasMore.value)
const gridLoading = computed(() => !searchResults.value && loading.value)

await useAsyncData('albums', fetchNextPage)

function gridItemKey(item: GridItem) {
  return item.type === 'new-album' ? 'new-album' : item.album.id
}

function formatDate(date: string) {
  return new Date(date).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
}

async function runSearch(keyword: string) {
  searching.value = true
  try {
    searchResults.value = await searchAlbums(keyword)
  }
  catch (error) {
    toast.add({ title: translateError(error), color: 'error' })
  }
  finally {
    searching.value = false
  }
}

watch(debouncedQuery, (value) => {
  if (!value.trim()) {
    searchResults.value = null
    return
  }

  runSearch(value.trim())
})
</script>

<template>
  <div class="mx-auto flex max-w-5xl flex-col gap-y-8">
    <h1 class="text-xl font-semibold">
      {{ tg('common.nav.albums') }}
    </h1>

    <label>
      <span class="sr-only">{{ t('searchLabel') }}</span>
      <UInput
        v-model="query"
        type="search"
        variant="soft"
        autofocus
        :placeholder="t('searchPlaceholder')"
        icon="ph:magnifying-glass"
        class="w-full"
      />
    </label>

    <div v-if="!displayedAlbums.length && !loading && !searching" class="py-20 text-center text-gray-500 dark:text-gray-300">
      <p v-if="searchResults">
        {{ t('noResults') }}
      </p>
      <p v-else>
        {{ t('empty') }}
      </p>
    </div>

    <BaseVirtualGrid
      :items="gridItems"
      :item-key="gridItemKey"
      :has-more="gridHasMore"
      :loading="gridLoading"
      :breakpoints="breakpoints"
      :gap="16"
      :extra-item-height="48"
      @load-more="fetchNextPage"
    >
      <template #default="{ item }">
        <NuxtLink
          v-if="item.type === 'new-album'"
          to="/albums/new"
          class="flex flex-col gap-y-2 overflow-hidden rounded"
        >
          <div class="aspect-square overflow-hidden rounded bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
            <Icon name="ph:plus" size="2em" class="text-gray-400" />
          </div>
          <div class="flex flex-col">
            <span class="truncate font-medium">{{ t('newAlbum') }}</span>
          </div>
        </NuxtLink>

        <NuxtLink
          v-else
          :to="`/albums/${item.album.id}`"
          class="flex flex-col gap-y-2 overflow-hidden rounded"
        >
          <div class="aspect-square overflow-hidden rounded bg-gray-200 dark:bg-gray-700">
            <BaseImg
              v-if="item.album.cover"
              :src="item.album.cover"
              :alt="item.album.title ?? t('albumCoverAlt')"
            />
            <div v-else class="flex h-full w-full items-center justify-center text-gray-400">
              <Icon name="ph:image" size="2em" />
            </div>
          </div>
          <div class="flex flex-col">
            <span class="truncate font-medium">{{ item.album.title }}</span>
            <span class="text-xs text-gray-500 dark:text-gray-300">{{ t('photoCount', item.album.photo_count) }} · {{ formatDate(item.album.created_at) }}</span>
          </div>
        </NuxtLink>
      </template>

      <template #loading>
        <p class="text-center text-sm text-gray-500 dark:text-gray-300">
          {{ t('loading') }}
        </p>
      </template>
    </BaseVirtualGrid>
  </div>
</template>

<i18n lang="json">
{
  "en": {
    "newAlbum": "New album",
    "searchLabel": "Search albums",
    "searchPlaceholder": "Search albums…",
    "noResults": "No albums match your search.",
    "empty": "You don't have any albums yet — create your first one to get started.",
    "albumCoverAlt": "Album cover",
    "loading": "Loading…",
    "photoCount": "{count} photo | {count} photos"
  }
}
</i18n>
