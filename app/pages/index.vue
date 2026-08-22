<script setup lang="ts">
import type { Photo } from '~/composables/usePhotoLibrary'

definePageMeta({ middleware: ['auth', 'storage-connection'] })

const { fullName } = useCurrentUser()
const { addError, addSuccess } = useAlerts()
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

interface UploadItem { id: string, name: string, progress: number, error: string | null }

const sentinel = ref<HTMLElement | null>(null)
const dropzoneActive = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
const uploads = ref<UploadItem[]>([])
const selectedIds = ref<Set<number>>(new Set())
const lastSelectedId = ref<number | null>(null)
const detailsPhotoId = ref<number | null>(null)
const detailsRef = ref<HTMLElement | null>(null)
const deleting = ref(false)

const { close: closeDeleteModal, open: openDeleteModal } = useModal('delete-photos')

const selectionMode = computed(() => selectedIds.value.size > 0)
const selectedCount = computed(() => selectedIds.value.size)

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

// Focuses the details overlay whenever it opens, so Escape/Arrow-key
// navigation (bound to the overlay's own @keydown handlers) works
// immediately — without this, keydown events only bubble from whatever
// element already had focus (e.g. the thumbnail button just clicked),
// which may sit outside the overlay's DOM subtree.
watch(detailsPhotoId, async (id) => {
  if (id === null)
    return
  await nextTick()
  detailsRef.value?.focus()
})

function showPrevious() {
  if (hasPrevious.value)
    detailsPhotoId.value = photos.value[detailsIndex.value - 1]!.id
}

function showNext() {
  if (hasNext.value)
    detailsPhotoId.value = photos.value[detailsIndex.value + 1]!.id
}

function onDetailsKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowLeft')
    showPrevious()
  else if (event.key === 'ArrowRight')
    showNext()
}

async function onToggleLike(photo: Photo) {
  try {
    await toggleLike(photo)
  }
  catch (error) {
    addError(translateError(error))
  }
}

async function downloadPhoto(photo: Photo) {
  const blob = await fetch(photo.url).then(response => response.blob())
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = photo.url.split('/').pop()?.split('?')[0] ?? `photo-${photo.id}`
  anchor.click()
  URL.revokeObjectURL(objectUrl)
}

async function downloadSelected() {
  const targets = photos.value.filter(photo => selectedIds.value.has(photo.id))
  try {
    for (const photo of targets) await downloadPhoto(photo)
  }
  catch (error) {
    addError(translateError(error))
  }
}

async function confirmDeleteSelected() {
  deleting.value = true
  try {
    await deletePhotos([...selectedIds.value])
    addSuccess(t('photosDeleted'))
    clearSelection()
    closeDeleteModal()
  }
  catch (error) {
    addError(translateError(error))
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

let observer: IntersectionObserver | null = null
let offRealtime: (() => void) | null = null

onMounted(async () => {
  await fetchNextPage()

  offRealtime = on('photo:uploaded', (photo: Photo) => addUploadedPhoto(photo))

  observer = new IntersectionObserver((entries) => {
    if (entries[0]?.isIntersecting && hasMore.value && !loading.value)
      fetchNextPage()
  })
  if (sentinel.value)
    observer.observe(sentinel.value)
})

onUnmounted(() => {
  observer?.disconnect()
  offRealtime?.()
})
</script>

<template>
  <div class="mx-auto flex max-w-5xl flex-col gap-y-8 py-10">
    <div class="flex items-center justify-between">
      <h1 class="text-xl font-semibold">
        {{ t('welcome', { name: fullName }) }}
      </h1>

      <button
        type="button"
        class="flex h-10 items-center gap-x-2 rounded bg-green-500 px-4 font-medium text-white hover:bg-green-600"
        @click="fileInput?.click()"
      >
        <Icon name="ph:upload-simple" size="1.1em" />
        {{ t('uploadPhotos') }}
      </button>
      <input ref="fileInput" type="file" accept="image/*" multiple class="hidden" @change="onFileInputChange">
    </div>

    <div
      class="flex flex-col items-center justify-center gap-y-2 rounded-lg border-2 border-dashed p-10 text-center text-sm text-slate-500 transition-colors dark:text-slate-300"
      :class="dropzoneActive ? 'border-green-500 bg-green-500/10' : 'border-slate-300 dark:border-slate-600'"
      @dragover.prevent="dropzoneActive = true"
      @dragleave.prevent="dropzoneActive = false"
      @drop.prevent="onDrop"
    >
      <Icon name="ph:image" size="2em" />
      <p>{{ t('dropzoneHint') }}</p>
    </div>

    <div v-if="uploads.length" class="flex flex-col gap-y-2">
      <div v-for="item in uploads" :key="item.id" class="flex flex-col gap-y-1 rounded bg-slate-200 p-3 text-sm dark:bg-slate-800">
        <div class="flex items-center justify-between">
          <span class="truncate">{{ item.name }}</span>
          <span v-if="item.error" class="text-red-500">{{ item.error }}</span>
          <span v-else>{{ item.progress }}%</span>
        </div>
        <div class="h-1.5 w-full overflow-hidden rounded-full bg-slate-300 dark:bg-slate-700">
          <div class="h-full bg-green-500 transition-all" :class="item.error && 'bg-red-500'" :style="{ width: `${item.progress}%` }" />
        </div>
      </div>
    </div>

    <div v-if="selectionMode" class="sticky top-16 z-10 flex items-center justify-between rounded bg-slate-200 px-4 py-2 dark:bg-slate-800">
      <span>{{ t('selectedCount', selectedCount) }}</span>
      <div class="flex gap-x-2">
        <button type="button" class="rounded px-3 py-1 hover:bg-slate-300 dark:hover:bg-slate-700" @click="downloadSelected">
          {{ t('download') }}
        </button>
        <button type="button" class="rounded px-3 py-1 text-red-500 hover:bg-slate-300 dark:hover:bg-slate-700" @click="openDeleteModal">
          {{ t('delete') }}
        </button>
        <button type="button" class="rounded px-3 py-1 hover:bg-slate-300 dark:hover:bg-slate-700" @click="clearSelection">
          {{ t('cancel') }}
        </button>
      </div>
    </div>

    <div v-if="!photos.length && !loading" class="py-20 text-center text-slate-500 dark:text-slate-300">
      <p>{{ t('empty') }}</p>
    </div>

    <div v-for="group in groupedByDate" :key="group.date" class="flex flex-col gap-y-3">
      <div class="flex items-center gap-x-3">
        <h2 class="text-sm font-semibold text-slate-600 dark:text-slate-300">
          {{ formatDate(group.date) }}
        </h2>
        <button type="button" class="text-xs text-green-600 hover:underline dark:text-green-400" @click="selectDay(group.date)">
          {{ t('selectDay') }}
        </button>
      </div>

      <div class="grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-6">
        <div v-for="photo in group.photos" :key="photo.id" class="group relative aspect-square overflow-hidden rounded">
          <button type="button" class="absolute inset-0" @click="onPhotoClick(photo, $event)">
            <img :src="photo.url" :alt="t('photoAlt', { id: photo.id })" class="h-full w-full object-cover" loading="lazy">
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

          <Icon v-if="photo.liked" name="ph:heart-fill" class="pointer-events-none absolute right-2 top-2 text-red-500" />
        </div>
      </div>
    </div>

    <div ref="sentinel" class="h-4" />
    <p v-if="loading" class="text-center text-sm text-slate-500 dark:text-slate-300">
      {{ t('loading') }}
    </p>

    <AppModal name="delete-photos">
      <div class="flex flex-col gap-y-6">
        <h2 class="text-lg font-semibold">
          {{ t('deleteModalTitle', selectedCount) }}
        </h2>
        <p>{{ t('deleteModalBody') }}</p>
        <div class="flex justify-end gap-3">
          <button type="button" class="h-10 rounded bg-slate-200 px-4 font-medium hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600" @click="closeDeleteModal">
            {{ t('cancel') }}
          </button>
          <button type="button" :disabled="deleting" class="h-10 rounded bg-red-500 px-4 font-medium text-white hover:bg-red-600 disabled:opacity-50" @click="confirmDeleteSelected">
            {{ deleting ? t('deleting') : t('delete') }}
          </button>
        </div>
      </div>
    </AppModal>

    <Transition name="modal-fade">
      <div
        v-if="detailsPhoto"
        ref="detailsRef"
        class="fixed inset-0 z-40 flex items-center justify-center bg-black/80"
        tabindex="0"
        @keydown="onDetailsKeydown"
        @keydown.esc="closeDetails"
        @click.self="closeDetails"
      >
        <button type="button" class="absolute right-4 top-4 text-white" :title="t('common.close')" @click="closeDetails">
          <Icon name="ph:x" size="1.5em" />
        </button>

        <button
          v-if="hasPrevious"
          type="button"
          class="absolute left-4 text-white"
          :title="t('previousPhoto')"
          @click="showPrevious"
        >
          <Icon name="ph:caret-left" size="2em" />
        </button>

        <div class="flex max-h-[85vh] max-w-[85vw] flex-col items-center gap-y-4">
          <img :src="detailsPhoto.url" :alt="t('photoAlt', { id: detailsPhoto.id })" class="max-h-[75vh] max-w-full rounded object-contain">
          <div class="flex items-center gap-x-4">
            <button type="button" class="flex items-center gap-x-1 text-white" @click="onToggleLike(detailsPhoto)">
              <Icon :name="detailsPhoto.liked ? 'ph:heart-fill' : 'ph:heart'" :class="detailsPhoto.liked && 'text-red-500'" />
              {{ detailsPhoto.liked ? t('liked') : t('like') }}
            </button>
            <button type="button" class="flex items-center gap-x-1 text-white" @click="downloadPhoto(detailsPhoto)">
              <Icon name="ph:download-simple" />
              {{ t('download') }}
            </button>
          </div>
        </div>

        <button
          v-if="hasNext"
          type="button"
          class="absolute right-4 text-white"
          :title="t('nextPhoto')"
          @click="showNext"
        >
          <Icon name="ph:caret-right" size="2em" />
        </button>
      </div>
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
