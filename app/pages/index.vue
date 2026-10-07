<script setup lang="ts">
import type { Photo } from '~/composables/usePhotoLibrary'
import type { GridColumnBreakpoint } from '~/composables/useVirtualGrid'

definePageMeta({ middleware: ['auth', 'storage-connection'] })

// Issue #175: the one grouped `BaseInfiniteScroll` consumer — every other
// page/modal is a flat list handled by `BaseVirtualGrid`, but the date
// headers here need to stay in-flow between their own day's photo rows,
// so this builds its own row descriptors directly on `useVirtualGrid`
// rather than going through that shared wrapper. Row *heights* are still
// fixed/uniform per row type (never measured), matching every other
// virtualized grid: a header row is a constant height (its own text plus
// the `gap-y-3` spacer down to its first photo row, plus a leading
// `gap-y-8` once it's not the very first group — mirroring the previous
// `flex flex-col gap-y-8`/`gap-y-3` layout), and a photo row is the
// current column width (square cells) plus the grid's own `gap-2`.
const breakpoints: GridColumnBreakpoint[] = [
  { minWidth: 0, columns: 2 },
  { minWidth: 640, columns: 4 },
  { minWidth: 768, columns: 6 },
]
const GAP = 8
const HEADER_ROW_HEIGHT = 32
const GROUP_SPACING = 32

interface HeaderRow { type: 'header', date: string, isFirstGroup: boolean }
interface PhotoRow { type: 'photos', photos: Photo[] }
type GridRow = HeaderRow | PhotoRow

const { translateError } = useErrorMessage()
const { on } = useRealtime()
const { t } = useI18n({ useScope: 'local', inheritLocale: true })
const {
  photos,
  groupedByDate,
  hasMore,
  loading,
  fetchNextPage,
  searchPhotos,
  addUploadedPhoto,
  toggleLike,
  updatePhoto,
  restorePhoto,
} = usePhotoLibrary()
const { results: searchResults, searching } = useSearch('library', searchPhotos)
const isSearching = computed(() => searchResults.value !== null)
// The grid's actual source of truth (issue #190): search results in
// place of the paginated library while a search is active, mirroring
// albums/index.vue's own `displayedAlbums`. Passed into usePhotoGallery
// below (not the raw paginated `photos`) so selection, multi-select
// shift-click ranges, and the details modal's prev/next all operate on
// whatever's actually on screen — a search result Photo can easily be
// one `photos` hasn't paginated in yet, so binding to `photos` directly
// would silently break clicking into an unpaginated match's details.
const displayedPhotos = computed(() => searchResults.value ?? photos.value)
const {
  selectedIds,
  selectionMode,
  detailsPhotoId,
  detailsPhoto,
  hasPrevious,
  hasNext,
  toggleSelection,
  showPrevious,
  showNext,
  closeDetails,
} = usePhotoGallery('library', displayedPhotos)
const { queueUpload, uploads } = usePhotoUpload()
const toast = useToast()

const container = useTemplateRef<HTMLElement | null>('container')
const { columnCount } = useGridColumns(container, breakpoints, GAP)

const rows = computed<GridRow[]>(() => {
  const result: GridRow[] = []
  groupedByDate.value.forEach((group, groupIndex) => {
    result.push({ type: 'header', date: group.date, isFirstGroup: groupIndex === 0 })
    for (let i = 0; i < group.photos.length; i += columnCount.value)
      result.push({ type: 'photos', photos: group.photos.slice(i, i + columnCount.value) })
  })
  return result
})

const { virtualRows, totalSize } = useVirtualGrid({
  container,
  breakpoints,
  gap: GAP,
  rowCount: () => rows.value.length,
  rowHeight: (index, _columnCount, columnWidth) => {
    const row = rows.value[index]
    if (row?.type === 'header')
      return HEADER_ROW_HEIGHT + (row.isFirstGroup ? 0 : GROUP_SPACING)
    return columnWidth + GAP
  },
  hasMore: computed(() => hasMore.value),
  loading: computed(() => loading.value),
  onLoadMore: () => fetchNextPage(),
})

await useAsyncData('photos', fetchNextPage)

function headerRow(index: number): HeaderRow | null {
  const row = rows.value[index]
  return row?.type === 'header' ? row : null
}

function photoRow(index: number): PhotoRow | null {
  const row = rows.value[index]
  return row?.type === 'photos' ? row : null
}

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
    <BaseDropzone class="mx-auto flex max-w-5xl flex-col gap-y-8" @drop="handleFiles">
      <PhotoUploads v-if="uploads.length" :uploads />

      <div v-if="!displayedPhotos.length && !loading && !searching" class="py-20 text-center text-gray-500 dark:text-gray-300">
        <p v-if="isSearching">
          {{ t('noResults') }}
        </p>
        <p v-else>
          {{ t('empty') }}
        </p>
      </div>

      <!-- Search results (issue #190): flattened, no date headers —
      unlike the grouped timeline below, a filtered result set has no
      obvious single day to group by, and mirrors how every other flat
      photo/album grid in this app renders its own search results. -->
      <BaseVirtualGrid
        v-else-if="isSearching"
        :items="displayedPhotos"
        :item-key="(photo: Photo) => photo.id"
        :has-more="false"
        :loading="searching"
        :breakpoints="breakpoints"
        :gap="GAP"
      >
        <template #default="{ item: photo }">
          <BaseGalleryPhoto
            :photo="photo"
            :is-selected="selectedIds.has(photo.id)"
            :selection-mode="selectionMode"
            @toggle-selection="toggleSelection"
            @toggle-like="onToggleLike"
            @restore="onRestorePhoto"
            @click="detailsPhotoId = photo.id"
          />
        </template>

        <template #loading>
          <p class="text-center text-sm text-gray-500 dark:text-gray-300">
            {{ t('loading') }}
          </p>
        </template>
      </BaseVirtualGrid>

      <div v-else ref="container" class="relative w-full" :style="{ height: `${totalSize}px` }">
        <template v-for="row in virtualRows" :key="row.index">
          <div
            v-if="headerRow(row.index)"
            class="absolute left-0 flex w-full items-end gap-x-3"
            :style="{
              top: `${row.start}px`,
              height: `${HEADER_ROW_HEIGHT + (headerRow(row.index)!.isFirstGroup ? 0 : GROUP_SPACING)}px`,
              paddingTop: `${headerRow(row.index)!.isFirstGroup ? 0 : GROUP_SPACING}px`,
            }"
          >
            <h2 class="text-sm font-semibold text-gray-600 dark:text-gray-300">
              {{ formatDate(headerRow(row.index)!.date) }}
            </h2>
            <button type="button" class="text-xs text-green-600 hover:underline dark:text-green-400" @click="selectDay(headerRow(row.index)!.date)">
              {{ t('selectDay') }}
            </button>
          </div>

          <div
            v-else
            class="absolute left-0 grid w-full"
            :style="{ top: `${row.start}px`, gridTemplateColumns: `repeat(${columnCount}, 1fr)`, gap: `${GAP}px` }"
          >
            <BaseGalleryPhoto
              v-for="photo in photoRow(row.index)?.photos ?? []"
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
        </template>
      </div>

      <p v-if="loading && !isSearching" class="text-center text-sm text-gray-500 dark:text-gray-300">
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
        @restore="onRestorePhoto"
        @close="closeDetails"
      />
    </Transition>
  </div>
</template>

<i18n lang="json">
{
  "en": {
    "noResults": "No photos match your search.",
    "empty": "Your photo library is empty — upload your first photo to get started.",
    "selectDay": "Select day",
    "loading": "Loading…"
  }
}
</i18n>
