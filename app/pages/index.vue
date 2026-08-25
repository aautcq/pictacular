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

const sentinel = useTemplateRef<HTMLElement | null>('sentinel')
const deleting = shallowRef(false)

const isDeleteModalOpen = shallowRef(false)

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

let offRealtime: (() => void) | null = null

useIntersectionObserver(sentinel, ([entry]) => {
  if (entry?.isIntersecting && hasMore.value && !loading.value)
    fetchNextPage()
})

onMounted(async () => {
  offRealtime = on('photo:uploaded', (photo: Photo) => addUploadedPhoto(photo))
})

onUnmounted(() => {
  offRealtime?.()
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
              @click="detailsPhotoId = photo.id"
            />
          </div>
        </div>

        <div ref="sentinel" class="h-4" />
        <p v-if="loading" class="text-center text-sm text-gray-500 dark:text-gray-300">
          {{ t('loading') }}
        </p>
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
          @close="closeDetails"
        />
      </Transition>

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
    "deleteModalTitle": "Delete {count} photo | Delete {count} photos",
    "deleteModalBody": "This action is irreversible. Are you sure?",
    "deleting": "Deleting…",
    "delete": "Delete",
    "download": "Download"
  }
}
</i18n>
