<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import type { Photo } from '~/composables/usePhotoLibrary'

definePageMeta({ middleware: ['auth', 'storage-connection'] })

const { fullName } = useCurrentUser()
const { translateError } = useErrorMessage()
const { on } = useRealtime()
const { t } = useI18n({ useScope: 'local', inheritLocale: true })
const {
  photos,
  groupedByDate,
  hasMore,
  loading,
  fetchNextPage,
  addUploadedPhoto,
  deletePhotos,
  toggleLike,
  updatePhoto,
  restorePhoto,
  restoreArchivedPhotos,
} = usePhotoLibrary()
const {
  selectedIds,
  selectedCount,
  selectionMode,
  detailsPhotoId,
  detailsPhoto,
  hasPrevious,
  hasNext,
  toggleSelection,
  clearSelection,
  showPrevious,
  showNext,
  closeDetails,
  downloadSelected,
} = usePhotoGallery(photos)
const { queueUpload, uploads } = usePhotoUpload()
const toast = useToast()

const deleting = shallowRef(false)
const restoringAll = shallowRef(false)

const isAddToAlbumModalOpen = shallowRef(false)
const isDeleteModalOpen = shallowRef(false)

const hasArchivedPhotos = computed(() => photos.value.some(photo => photo.archived_state === 'archived'))

await useAsyncData('photos', fetchNextPage)

function formatDate(date: string) {
  return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
}

function selectDay(date: string) {
  const group = groupedByDate.value.find(entry => entry.date === date)
  if (!group)
    return

  const groupIds = group.photos.map(photo => photo.id)
  const allSelected = groupIds.every(id => selectedIds.value.has(id))
  const next = new Set(selectedIds.value)
  for (const id of groupIds) {
    if (allSelected)
      next.delete(id)
    else
      next.add(id)
  }
  selectedIds.value = next
}

async function onToggleLike(photo: Photo) {
  try {
    await toggleLike(photo)
  }
  catch (error) {
    toast.add({ title: translateError(error), color: 'error' })
  }
}

async function onRestorePhoto(photo: Photo) {
  try {
    await restorePhoto(photo.id)
  }
  catch (error) {
    toast.add({ title: translateError(error), color: 'error' })
  }
}

async function onRestoreArchivedPhotos() {
  restoringAll.value = true
  try {
    const { restored, failed } = await restoreArchivedPhotos()
    toast.add({ title: failed ? t('restoreAllPartial', failed) : t('restoreAllStarted', restored) })
  }
  catch (error) {
    toast.add({ title: translateError(error), color: 'error' })
  }
  finally {
    restoringAll.value = false
  }
}

async function confirmDeleteSelected() {
  deleting.value = true
  try {
    await deletePhotos([...selectedIds.value])
    toast.add({ title: t('photosDeleted') })
    clearSelection()
    isDeleteModalOpen.value = false
  }
  catch (error) {
    toast.add({ title: translateError(error), color: 'error' })
  }
  finally {
    deleting.value = false
  }
}

async function handleFiles(fileList: FileList | null) {
  if (!fileList)
    return
  for (const file of Array.from(fileList)) {
    if (file.type.startsWith('image/')) {
      const photo = await queueUpload(file)
      if (photo)
        addUploadedPhoto(photo)
    }
  }
}

const settingsItems = ref<DropdownMenuItem[][]>([
  [
    {
      label: t('addToAlbumButton'),
      icon: 'ph:plus',
      onSelect: () => { isAddToAlbumModalOpen.value = true },
    },
  ],
  [
    {
      label: t('download'),
      icon: 'ph:download-simple',
      onSelect: () => { downloadSelected() },
    },
  ],
  [
    {
      label: t('delete'),
      icon: 'ph:trash',
      color: 'error',
      onSelect: () => { isDeleteModalOpen.value = true },
    },
  ],
])

let offRealtimeUploaded: (() => void) | null = null
let offRealtimeRestored: (() => void) | null = null

onMounted(async () => {
  offRealtimeUploaded = on('photo:uploaded', (photo: Photo) => addUploadedPhoto(photo))
  offRealtimeRestored = on('photo:restored', (photo: Photo) => updatePhoto(photo))
})

onUnmounted(() => {
  offRealtimeUploaded?.()
  offRealtimeRestored?.()
})
</script>

<template>
  <div>
    <NuxtLayout name="default">
      <template #header-actions>
        <HeaderSelectedMenu
          v-if="selectionMode"
          :selected-count="selectedCount"
          @cancel-selection="clearSelection"
        />

        <UDropdownMenu v-if="selectionMode" :items="settingsItems">
          <UTooltip :text="t('settings')">
            <UButton
              icon="ph:dots-three-vertical"
              color="neutral"
              variant="soft"
              :aria-label="t('settings')"
            />
          </UTooltip>
        </UDropdownMenu>

        <UTooltip v-if="hasArchivedPhotos && !selectionMode" :text="t('restoreAll')">
          <UButton
            icon="ph:cloud-arrow-down"
            color="neutral"
            variant="soft"
            :loading="restoringAll"
            :aria-label="t('restoreAll')"
            @click="onRestoreArchivedPhotos"
          />
        </UTooltip>

        <BaseFilesUpload @files-uploaded="handleFiles" />
      </template>

      <BaseDropzone class="mx-auto flex max-w-5xl flex-col gap-y-8" @drop="handleFiles">
        <h1 class="text-xl font-semibold">
          {{ t('welcome', { name: fullName }) }}
        </h1>

        <PhotoUploads v-if="uploads.length" :uploads />

        <div v-if="!photos.length && !loading" class="py-20 text-center text-gray-500 dark:text-gray-300">
          <p>{{ t('empty') }}</p>
        </div>

        <div v-for="group in groupedByDate" :key="group.date" class="flex flex-col gap-y-3">
          <div class="flex items-center gap-x-3">
            <h2 class="text-sm font-semibold text-gray-600 dark:text-gray-300">
              {{ formatDate(group.date) }}
            </h2>
            <button type="button" class="text-xs text-green-600 hover:underline dark:text-green-400" @click="selectDay(group.date)">
              {{ t('selectDay') }}
            </button>
          </div>

          <div class="grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-6">
            <BaseGalleryPhoto
              v-for="photo in group.photos"
              :key="photo.id"
              :photo="photo"
              :is-selected="selectedIds.has(photo.id)"
              :selection-mode="selectionMode"
              @toggle-selection="toggleSelection"
              @toggle-like="onToggleLike"
              @restore="onRestorePhoto"
              @click="detailsPhotoId = photo.id"
            />
          </div>
        </div>

        <BaseInfiniteScroll :has-more="hasMore" :loading="loading" @load-more="fetchNextPage">
          <template #loading>
            <p class="text-center text-sm text-gray-500 dark:text-gray-300">
              {{ t('loading') }}
            </p>
          </template>
        </BaseInfiniteScroll>
      </BaseDropzone>

      <Transition name="modal-fade">
        <PhotoDetails
          v-if="detailsPhoto"
          :photo="detailsPhoto"
          :has-previous="hasPrevious"
          :has-next="hasNext"
          @show-previous="showPrevious"
          @show-next="showNext"
          @toggle-like="onToggleLike"
          @restore="onRestorePhoto"
          @close="closeDetails"
        />
      </Transition>

      <AddToAlbumModal
        v-model:is-open="isAddToAlbumModalOpen"
        :photo-ids="[...selectedIds]"
        @added="clearSelection"
      />

      <UModal
        v-model:open="isDeleteModalOpen"
        :title="t('deleteModalTitle', selectedCount)"
        :description="t('deleteModalBody')"
      >
        <template #footer="{ close }">
          <UButton
            type="button"
            :label="t('cancel')"
            color="neutral"
            variant="soft"
            @click="close"
          />
          <UButton
            type="button"
            :loading="deleting"
            :label="deleting ? t('deleting') : t('delete')"
            color="error"
            @click="confirmDeleteSelected"
          />
        </template>
      </UModal>
    </NuxtLayout>
  </div>
</template>

<i18n lang="json">
{
  "en": {
    "welcome": "Welcome, {name}",
    "dropzoneHint": "Drag and drop photos here, or use the Upload photos button above.",
    "selectedCount": "{count} selected | {count} selected",
    "cancel": "Cancel",
    "empty": "Your photo library is empty — upload your first photo to get started.",
    "selectDay": "Select day",
    "photoAlt": "Photo {id}",
    "select": "Select",
    "loading": "Loading…",
    "previousPhoto": "Previous photo",
    "nextPhoto": "Next photo",
    "liked": "Liked",
    "like": "Like",
    "photosDeleted": "Photos deleted.",
    "settings": "Settings",
    "addToAlbumButton": "Add to album",
    "deleteModalTitle": "Delete {count} photo | Delete {count} photos",
    "deleteModalBody": "This action is irreversible. Are you sure?",
    "deleting": "Deleting…",
    "delete": "Delete",
    "download": "Download",
    "restoreAll": "Restore all archived photos",
    "restoreAllStarted": "No archived photos to restore. | Restoring {count} archived photo — you'll be notified once it's ready. | Restoring {count} archived photos — you'll be notified once they're ready.",
    "restoreAllPartial": "Restore requested, but {count} photo couldn't be restored. Check your storage connection. | Restore requested, but {count} photos couldn't be restored. Check your storage connection."
  }
}
</i18n>
