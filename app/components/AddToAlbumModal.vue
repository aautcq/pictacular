<script setup lang="ts">
import type { AlbumSummary } from '~/composables/useAlbums'

const props = defineProps<{ photoIds: number[] }>()
const emit = defineEmits<{ added: [albumId: number] }>()
const isOpen = defineModel<boolean>('isOpen', { required: true })
const { albums, hasMore, loaded, loading, fetchNextPage, searchAlbums, addPhotoToAlbum } = useAlbums()
const toast = useToast()
const { translateError } = useErrorMessage()
const { t } = useI18n({ useScope: 'local', inheritLocale: true })

const grid = useTemplateRef<HTMLElement | null>('grid')
const sentinel = useTemplateRef<HTMLElement | null>('sentinel')
const query = shallowRef('')
const debouncedQuery = refDebounced(query, 300)
const searchResults = ref<AlbumSummary[] | null>(null)
const searching = shallowRef(false)
const saving = shallowRef(false)

const displayedAlbums = computed(() => searchResults.value ?? albums.value)

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

watch(isOpen, async (newValue) => {
  if (newValue && !loaded.value)
    await fetchNextPage()

  if (!newValue) {
    query.value = ''
    searchResults.value = null
  }
})

// Observed relative to the grid's own scroll container (rather than the
// default viewport `root`) since the grid scrolls internally within the
// modal — otherwise the sentinel would never cross the viewport boundary
// while the user scrolls the grid.
useIntersectionObserver(sentinel, ([entry]) => {
  if (entry?.isIntersecting && !searchResults.value && hasMore.value && !loading.value)
    fetchNextPage()
}, { root: grid })

async function addToAlbum(albumId: number) {
  if (saving.value)
    return

  saving.value = true
  try {
    const results = await Promise.allSettled(props.photoIds.map(photoId => addPhotoToAlbum(albumId, photoId)))
    const failed = results.filter(result => result.status === 'rejected')
    if (failed.length === props.photoIds.length && failed.length > 0) {
      toast.add({ title: translateError(failed[0]!.reason), color: 'error' })
      return
    }

    toast.add({ title: failed.length ? t('addedPartial', failed.length) : t('added') })
    emit('added', albumId)
    isOpen.value = false
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="isOpen"
    :title="t('addToAlbumModalTitle')"
  >
    <template #body>
      <label>
        <span class="sr-only">{{ t('searchLabel') }}</span>
        <UInput
          v-model="query"
          type="search"
          variant="soft"
          :placeholder="t('searchPlaceholder')"
          icon="ph:magnifying-glass"
          class="w-full mb-3"
        />
      </label>

      <p v-if="!displayedAlbums.length && !loading && !searching" class="py-8 text-center text-gray-500 dark:text-gray-300">
        <span v-if="searchResults">{{ t('noResults') }}</span>
        <span v-else>{{ t('empty') }}</span>
      </p>

      <div ref="grid" class="grid max-h-96 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
        <button
          v-for="album in displayedAlbums"
          :key="album.id"
          type="button"
          :disabled="saving"
          class="flex flex-col gap-y-1 disabled:opacity-50"
          @click="addToAlbum(album.id)"
        >
          <div class="aspect-square w-full overflow-hidden rounded bg-gray-200 dark:bg-gray-700">
            <BaseImg
              v-if="album.cover"
              :src="album.cover"
              :alt="album.title ?? t('albumCoverAlt')"
            />
            <div v-else class="flex h-full w-full items-center justify-center text-gray-400">
              <Icon name="ph:image" size="2em" />
            </div>
          </div>
          <span class="truncate text-sm font-medium">{{ album.title }}</span>
        </button>

        <div v-if="!searchResults" ref="sentinel" class="h-4" />
      </div>

      <p v-if="loading" class="text-center text-sm text-gray-500 dark:text-gray-300">
        {{ t('loading') }}
      </p>
    </template>

    <template #footer="{ close }">
      <UButton
        type="button"
        :label="t('cancel')"
        color="neutral"
        variant="soft"
        @click="close"
      />
    </template>
  </UModal>
</template>

<i18n lang="json">
{
  "en": {
    "addToAlbumModalTitle": "Add to album",
    "searchLabel": "Search albums",
    "searchPlaceholder": "Search albums…",
    "noResults": "No albums match your search.",
    "empty": "You don't have any albums yet.",
    "albumCoverAlt": "Album cover",
    "loading": "Loading…",
    "added": "Added to album.",
    "addedPartial": "Added to album, but {count} photo couldn't be added. | Added to album, but {count} photos couldn't be added.",
    "cancel": "Cancel"
  }
}
</i18n>
