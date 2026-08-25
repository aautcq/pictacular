<script setup lang="ts">
import type { AlbumSummary } from '~/composables/useAlbums'

definePageMeta({ middleware: ['auth'] })

const { albums, hasMore, loading, fetchNextPage, searchAlbums } = useAlbums()
const toast = useToast()
const { translateError } = useErrorMessage()
const { t } = useI18n({ useScope: 'local', inheritLocale: true })
const { t: tg } = useI18n({ useScope: 'global' })

const sentinel = useTemplateRef<HTMLElement | null>('sentinel')
const query = shallowRef('')
const debouncedQuery = refDebounced(query, 300)
const searchResults = ref<AlbumSummary[] | null>(null)
const searching = shallowRef(false)

const displayedAlbums = computed(() => searchResults.value ?? albums.value)

await useAsyncData('albums', fetchNextPage)

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

useIntersectionObserver(sentinel, ([entry]) => {
  if (entry?.isIntersecting && !searchResults.value && hasMore.value && !loading.value)
    fetchNextPage()
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

    <div class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
      <NuxtLink
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
        v-for="album in displayedAlbums"
        :key="album.id"
        :to="`/albums/${album.id}`"
        class="flex flex-col gap-y-2 overflow-hidden rounded"
      >
        <div class="aspect-square overflow-hidden rounded bg-gray-200 dark:bg-gray-700">
          <BaseImg
            v-if="album.cover"
            :src="album.cover"
            :alt="album.title ?? t('albumCoverAlt')"
          />
          <div v-else class="flex h-full w-full items-center justify-center text-gray-400">
            <Icon name="ph:image" size="2em" />
          </div>
        </div>
        <div class="flex flex-col">
          <span class="truncate font-medium">{{ album.title }}</span>
          <span class="text-xs text-gray-500 dark:text-gray-300">{{ formatDate(album.created_at) }}</span>
        </div>
      </NuxtLink>
    </div>

    <div ref="sentinel" class="h-4" />
    <p v-if="loading" class="text-center text-sm text-gray-500 dark:text-gray-300">
      {{ t('loading') }}
    </p>
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
    "loading": "Loading…"
  }
}
</i18n>
