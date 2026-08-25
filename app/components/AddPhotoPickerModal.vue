<script setup lang="ts">
import type { AlbumFull } from '~/composables/useAlbums'

const album = defineModel<AlbumFull>({ required: true })
const isOpen = defineModel<boolean>('isOpen', { required: true })

const { addPhotoToAlbum, removePhotoFromAlbum } = useAlbums()
const {
  photos: libraryPhotos,
  fetchNextPage: fetchNextLibraryPage,
  hasMore: libraryHasMore,
  loading: libraryLoading,
} = usePhotoLibrary()
const toast = useToast()
const { translateError } = useErrorMessage()
const { t } = useI18n({ useScope: 'local', inheritLocale: true })

const savingPhotoId = shallowRef<number | null>(null)

const albumPhotoIds = computed(() => new Set(album.value?.photos.map(photo => photo.id) ?? []))

async function togglePhoto(photoId: number) {
  savingPhotoId.value = photoId
  try {
    album.value = albumPhotoIds.value.has(photoId)
      ? await removePhotoFromAlbum(album.value.id, photoId)
      : await addPhotoToAlbum(album.value.id, photoId)
  }
  catch (error) {
    toast.add({ title: translateError(error), color: 'error' })
  }
  finally {
    savingPhotoId.value = null
  }
}

watch(() => isOpen.value, async (newValue) => {
  if (newValue && !libraryPhotos.value.length)
    await fetchNextLibraryPage()
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

      <div class="grid grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
        <button
          v-for="photo in libraryPhotos"
          :key="photo.id"
          type="button"
          :disabled="savingPhotoId === photo.id"
          class="group relative aspect-square overflow-hidden rounded disabled:opacity-50"
          @click="togglePhoto(photo.id)"
        >
          <BaseImg :src="photo.url" :alt="getPhotoFileName(photo)" />
          <div
            v-if="albumPhotoIds.has(photo.id)"
            class="absolute inset-0 flex items-center justify-center bg-green-500/50"
          >
            <Icon name="ph:check-bold" class="text-white" size="1.5em" />
          </div>
        </button>
      </div>

      <button
        v-if="libraryHasMore"
        type="button"
        class="text-sm text-green-600 hover:underline dark:text-green-400"
        :disabled="libraryLoading"
        @click="fetchNextLibraryPage"
      >
        {{ libraryLoading ? t('loading') : t('loadMore') }}
      </button>
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
    "loadMore": "Load more",
    "done": "Done"
  }
}
</i18n>
