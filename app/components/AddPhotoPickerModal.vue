<script setup lang="ts">
import type { Photo } from '~/composables/usePhotoLibrary'

const { albumId } = defineProps<{ albumId: number }>()
const emit = defineEmits<{ photoAdded: [photo: Photo], photoRemoved: [photoId: number] }>()
const isOpen = defineModel<boolean>('isOpen', { required: true })

const { addPhotoToAlbum, removePhotoFromAlbum, fetchAlbumPhotoIds } = useAlbums()
const {
  photos: libraryPhotos,
  fetchNextPage: fetchNextLibraryPage,
  hasMore: libraryHasMore,
  loaded: libraryLoaded,
  loading: libraryLoading,
} = usePhotoLibrary()
const toast = useToast()
const { translateError } = useErrorMessage()
const { t } = useI18n({ useScope: 'local', inheritLocale: true })

const grid = useTemplateRef<HTMLElement | null>('grid')
const savingPhotoId = shallowRef<number | null>(null)
const loadingMembership = shallowRef(false)
// Issue #170: the Album no longer carries its full Photo list (it can
// hold thousands), so membership is tracked as its own lightweight id
// Set — fetched once per open via the cheap GET /api/albums/:id/photo-ids
// endpoint, then updated optimistically on each toggle below rather than
// re-fetched, since add/remove no longer echo back the whole Album either.
const albumPhotoIds = ref<Set<number>>(new Set())

async function togglePhoto(photo: Photo) {
  savingPhotoId.value = photo.id
  try {
    if (albumPhotoIds.value.has(photo.id)) {
      await removePhotoFromAlbum(albumId, photo.id)
      albumPhotoIds.value = new Set([...albumPhotoIds.value].filter(id => id !== photo.id))
      emit('photoRemoved', photo.id)
    }
    else {
      const added = await addPhotoToAlbum(albumId, photo.id)
      albumPhotoIds.value = new Set([...albumPhotoIds.value, added.id])
      emit('photoAdded', added)
    }
  }
  catch (error) {
    toast.add({ title: translateError(error), color: 'error' })
  }
  finally {
    savingPhotoId.value = null
  }
}

watch(() => isOpen.value, async (newValue) => {
  if (!newValue)
    return

  if (!libraryLoaded.value)
    await fetchNextLibraryPage()

  loadingMembership.value = true
  try {
    albumPhotoIds.value = new Set(await fetchAlbumPhotoIds(albumId))
  }
  catch (error) {
    toast.add({ title: translateError(error), color: 'error' })
  }
  finally {
    loadingMembership.value = false
  }
})
</script>

<template>
  <UModal
    v-model:open="isOpen"
    :title="t('addPhotosModalTitle')"
  >
    <template #body>
      <p v-if="!libraryPhotos.length && !libraryLoading" class="text-gray-500 dark:text-gray-300">
        {{ t('libraryEmpty') }}
      </p>

      <div ref="grid" class="grid max-h-96 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
        <button
          v-for="photo in libraryPhotos"
          :key="photo.id"
          type="button"
          :disabled="savingPhotoId === photo.id || loadingMembership"
          class="group relative aspect-square overflow-hidden rounded disabled:opacity-50"
          @click="togglePhoto(photo)"
        >
          <BaseImg :src="photo.url" :alt="getPhotoFileName(photo)" />
          <div
            v-if="albumPhotoIds.has(photo.id)"
            class="absolute inset-0 flex items-center justify-center bg-green-500/50"
          >
            <Icon name="ph:check-bold" class="text-white" size="1.5em" />
          </div>
        </button>

        <BaseInfiniteScroll :has-more="libraryHasMore" :loading="libraryLoading" :root="grid" @load-more="fetchNextLibraryPage" />
      </div>

      <p v-if="libraryLoading" class="text-center text-sm text-gray-500 dark:text-gray-300">
        {{ t('loading') }}
      </p>
    </template>

    <template #footer="{ close }">
      <UButton
        type="button"
        :label="t('done')"
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
    "addPhotosModalTitle": "Add photos to album",
    "libraryEmpty": "Your photo library is empty.",
    "loading": "Loading…",
    "done": "Done"
  }
}
</i18n>
