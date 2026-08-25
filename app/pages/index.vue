<script setup lang="ts">
import type { Photo } from '~/composables/usePhotoLibrary'

definePageMeta({ middleware: ['auth', 'storage-connection'] })

const { fullName } = useCurrentUser()
const { translateError } = useErrorMessage()
const { on } = useRealtime()
const { t } = useI18n()
const {
  photos,
  groupedByDate,
  hasMore,
  loading,
  fetchNextPage,
  addUploadedPhoto,
  uploadPhoto,
  deletePhotos,
  toggleLike,
} = usePhotoLibrary()
const toast = useToast()

interface UploadItem { id: string, name: string, progress: number, error: string | null }

const sentinel = useTemplateRef<HTMLElement | null>('sentinel')
const dropzoneActive = shallowRef(false)
const fileInput = useTemplateRef<HTMLInputElement | null>('fileInput')
const uploads = ref<UploadItem[]>([])
const selectedIds = ref<Set<number>>(new Set())
const lastSelectedId = shallowRef<number | null>(null)
const detailsPhotoId = shallowRef<number | null>(null)
const deleting = shallowRef(false)

const isDeleteModalOpen = shallowRef(false)

const selectedCount = computed(() => selectedIds.value.size)
const selectionMode = computed(() => selectedCount.value > 0)

await useAsyncData('photos', fetchNextPage)

const detailsIndex = computed(() => photos.value.findIndex(photo => photo.id === detailsPhotoId.value))
const detailsPhoto = computed(() => detailsIndex.value === -1 ? null : photos.value[detailsIndex.value]!)
const hasPrevious = computed(() => detailsIndex.value > 0)
const hasNext = computed(() => detailsIndex.value !== -1 && detailsIndex.value < photos.value.length - 1)

function formatDate(date: string) {
  return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
}

function isSelected(id: number) {
  return selectedIds.value.has(id)
}

function toggleSelection(photo: Photo, event: MouseEvent) {
  const ids = photos.value.map(item => item.id)
  const clickedIndex = ids.indexOf(photo.id)

  if (event.shiftKey && lastSelectedId.value !== null) {
    const anchorIndex = ids.indexOf(lastSelectedId.value)
    if (anchorIndex !== -1) {
      const [start, end] = anchorIndex < clickedIndex ? [anchorIndex, clickedIndex] : [clickedIndex, anchorIndex]
      const next = new Set(selectedIds.value)
      for (const id of ids.slice(start, end + 1)) next.add(id)
      selectedIds.value = next
      return
    }
  }

  const next = new Set(selectedIds.value)
  if (next.has(photo.id))
    next.delete(photo.id)
  else
    next.add(photo.id)
  selectedIds.value = next
  lastSelectedId.value = photo.id
}

// Clicking a photo either toggles its selection (once selection has
// started, or with Shift held for a range-select) or opens the details
// modal — matching the legacy List.vue's single/shift-select + click-to-open
// behavior.
function onPhotoClick(photo: Photo, event: MouseEvent) {
  if (selectionMode.value || event.shiftKey)
    toggleSelection(photo, event)
  else
    detailsPhotoId.value = photo.id
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

function clearSelection() {
  selectedIds.value = new Set()
  lastSelectedId.value = null
}

function closeDetails() {
  detailsPhotoId.value = null
}

function showPrevious() {
  detailsPhotoId.value = photos.value[detailsIndex.value - 1]!.id
}

function showNext() {
  detailsPhotoId.value = photos.value[detailsIndex.value + 1]!.id
}

async function onToggleLike(photo: Photo) {
  try {
    await toggleLike(photo)
  }
  catch (error) {
    toast.add({ title: translateError(error), color: 'error' })
  }
}

async function downloadSelected() {
  try {
    for (const photo of photos.value.filter(photo => selectedIds.value.has(photo.id))) {
      await downloadFile(
        photo.url,
        photo.url.split('/').pop()?.split('?')[0] ?? `photo-${photo.id}`,
      )
    }
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

function queueUpload(file: File) {
  const id = crypto.randomUUID()
  uploads.value = [...uploads.value, { id, name: file.name, progress: 0, error: null }]

  uploadPhoto(file, (percent) => {
    uploads.value = uploads.value.map(item => item.id === id ? { ...item, progress: percent } : item)
  })
    .then(() => {
      uploads.value = uploads.value.filter(item => item.id !== id)
    })
    .catch((error) => {
      uploads.value = uploads.value.map(item => item.id === id ? { ...item, error: translateError(error) } : item)
    })
}

function handleFiles(fileList: FileList | null) {
  if (!fileList)
    return
  for (const file of Array.from(fileList)) {
    if (file.type.startsWith('image/'))
      queueUpload(file)
  }
}

function onFileInputChange(event: Event) {
  handleFiles((event.target as HTMLInputElement).files)
  if (fileInput.value)
    fileInput.value.value = ''
}

function onDrop(event: DragEvent) {
  dropzoneActive.value = false
  handleFiles(event.dataTransfer?.files ?? null)
}

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
  <div class="mx-auto flex max-w-5xl flex-col gap-y-8">
    <div class="flex items-center justify-between">
      <h1 class="text-xl font-semibold">
        {{ t('welcome', { name: fullName }) }}
      </h1>

      <UButton
        type="button"
        icon="ph:upload-simple"
        :label="t('uploadPhotos')"
        @click="fileInput?.click()"
      />
      <input
        ref="fileInput"
        type="file"
        accept="image/*"
        multiple
        class="hidden"
        aria-hidden="true"
        @change="onFileInputChange"
      >
    </div>

    <div
      class="flex flex-col items-center justify-center gap-y-2 rounded-lg border-2 border-dashed p-10 text-center text-sm text-gray-500 transition-colors dark:text-gray-300"
      :class="dropzoneActive ? 'border-green-500 bg-green-500/10' : 'border-gray-300 dark:border-gray-600'"
      @dragover.prevent="dropzoneActive = true"
      @dragleave.prevent="dropzoneActive = false"
      @drop.prevent="onDrop"
    >
      <Icon name="ph:image" size="3rem" />
      <p>{{ t('dropzoneHint') }}</p>
    </div>

    <div v-if="uploads.length" class="flex flex-col gap-y-2">
      <div v-for="item in uploads" :key="item.id" class="flex flex-col gap-y-1 rounded bg-gray-200 p-3 text-sm dark:bg-gray-900">
        <div class="flex items-center justify-between">
          <span class="truncate">{{ item.name }}</span>
          <span v-if="item.error" class="text-red-500">{{ item.error }}</span>
          <span v-else>{{ item.progress }}%</span>
        </div>
        <div class="h-1.5 w-full overflow-hidden rounded-full bg-gray-300 dark:bg-gray-700">
          <div class="h-full bg-green-500 transition-all" :class="item.error && 'bg-red-500'" :style="{ width: `${item.progress}%` }" />
        </div>
      </div>
    </div>

    <div v-if="selectionMode" class="sticky top-16 z-10 flex items-center justify-between rounded bg-gray-200 px-4 py-2 dark:bg-gray-900">
      <span>{{ t('selectedCount', selectedCount) }}</span>
      <div class="flex gap-x-2">
        <UTooltip :text="t('download')">
          <UButton
            type="button"
            :aria-label="t('download')"
            color="neutral"
            variant="soft"
            icon="ph:download-simple"
            @click="downloadSelected"
          />
        </UTooltip>
        <UModal
          v-model:open="isDeleteModalOpen"
          :title="t('deleteModalTitle', selectedCount)"
          :description="t('deleteModalBody')"
        >
          <UTooltip :text="t('delete')">
            <UButton
              type="button"
              :aria-label="t('delete')"
              color="error"
              variant="soft"
              icon="ph:trash"
            />
          </UTooltip>

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
        <UTooltip :text="t('cancel')">
          <UButton
            type="button"
            :aria-label="t('cancel')"
            color="neutral"
            variant="soft"
            icon="ph:x"
            @click="clearSelection"
          />
        </UTooltip>
      </div>
    </div>

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
        <div
          v-for="photo in group.photos"
          :key="photo.id"
          class="group relative aspect-square overflow-hidden rounded"
        >
          <button
            type="button"
            class="absolute inset-0"
            @click="onPhotoClick(photo, $event)"
          >
            <img
              :src="photo.url"
              :alt="t('photoAlt', { id: photo.id })"
              class="h-full w-full object-cover"
              loading="lazy"
            >
          </button>

          <button
            type="button"
            :title="t('select')"
            class="absolute left-2 top-2 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-black/30 transition-opacity"
            :class="isSelected(photo.id) ? 'bg-green-500 opacity-100' : 'opacity-0 group-hover:opacity-100'"
            @click.stop="toggleSelection(photo, $event)"
          >
            <Icon v-if="isSelected(photo.id)" name="ph:check-bold" class="text-white" />
          </button>

          <Icon
            v-if="photo.liked"
            name="ph:heart-fill"
            class="pointer-events-none absolute right-2 top-2 text-red-500"
          />
        </div>
      </div>
    </div>

    <div ref="sentinel" class="h-4" />
    <p v-if="loading" class="text-center text-sm text-gray-500 dark:text-gray-300">
      {{ t('loading') }}
    </p>

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
  </div>
</template>

<i18n lang="json">
{
  "en": {
    "welcome": "Welcome, {name}",
    "uploadPhotos": "Upload photos",
    "dropzoneHint": "Drag and drop photos here, or use the Upload photos button above.",
    "selectedCount": "{count} selected | {count} selected",
    "download": "Download",
    "delete": "Delete",
    "cancel": "Cancel",
    "empty": "Your photo library is empty — upload your first photo to get started.",
    "selectDay": "Select day",
    "photoAlt": "Photo {id}",
    "select": "Select",
    "loading": "Loading…",
    "deleteModalTitle": "Delete {count} photo | Delete {count} photos",
    "deleteModalBody": "This action is irreversible. Are you sure?",
    "deleting": "Deleting…",
    "previousPhoto": "Previous photo",
    "nextPhoto": "Next photo",
    "liked": "Liked",
    "like": "Like",
    "photosDeleted": "Photos deleted."
  }
}
</i18n>
