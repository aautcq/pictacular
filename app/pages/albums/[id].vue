<script setup lang="ts">
import type { GridColumnBreakpoint } from '~/composables/useVirtualGrid'

definePageMeta({ middleware: ['auth'] })

const breakpoints: GridColumnBreakpoint[] = [
  { minWidth: 0, columns: 2 },
  { minWidth: 640, columns: 4 },
  { minWidth: 768, columns: 6 },
]

const route = useRoute()
const albumId = computed(() => Number(route.params.id))

const { user } = useCurrentUser()
const { fetchAlbum, updateAlbum } = useAlbums()
const { toggleLike } = usePhotoLibrary()
const { queueUpload, uploads } = usePhotoUpload()
const toast = useToast()
const { translateError } = useErrorMessage()
const { t } = useI18n({ useScope: 'local', inheritLocale: true })
const { t: tg } = useI18n({ useScope: 'global' })

const editingTitle = shallowRef(false)
const editingDescription = shallowRef(false)
const titleDraft = shallowRef('')
const descriptionDraft = shallowRef('')

const {
  photos,
  hasMore: photosHaveMore,
  loading: photosLoading,
  fetchNextPage: fetchNextPhotosPage,
  searchPhotos,
  prependPhoto,
  updatePhoto,
} = useAlbumPhotos(albumId)

// Issue #170: an Album can hold thousands of Photos, so its metadata and
// its first page of Photos are two separate requests — run together
// rather than one after the other, so `pending` going false always means
// both the metadata and at least the first Photo page are ready.
const [{ data: album, pending }] = await Promise.all([
  useAsyncData('album', async () => await fetchAlbum(albumId.value), { watch: [albumId] }),
  useAsyncData('album-photos', fetchNextPhotosPage),
])

// Issue #190: search scoped to this Album's own Photos (filename only —
// see useAlbumPhotos#searchPhotos). Same "search results replace the
// paginated grid" shape as the library page and albums/index.vue.
const { results: searchResults, searching } = useSearch('album-detail', searchPhotos)
const isSearching = computed(() => searchResults.value !== null)
const displayedPhotos = computed(() => searchResults.value ?? photos.value)
const gridHasMore = computed(() => !isSearching.value && photosHaveMore.value)
const gridLoading = computed(() => isSearching.value ? searching.value : photosLoading.value)

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
} = usePhotoGallery('album-detail', displayedPhotos)

useHead({ title: computed(() => album.value?.title) })

const isAdmin = computed(() => !!album.value && !!user.value && album.value.admin.id === user.value.id)

function startEditTitle() {
  if (!isAdmin.value)
    return
  titleDraft.value = album.value?.title ?? ''
  editingTitle.value = true
}

async function saveTitle() {
  if (!album.value)
    return
  editingTitle.value = false
  const trimmed = titleDraft.value.trim()
  if (!trimmed || trimmed === album.value.title)
    return

  try {
    const updated = await updateAlbum(album.value.id, { title: trimmed })
    album.value = { ...album.value, ...updated }
  }
  catch (error) {
    toast.add({ title: translateError(error), color: 'error' })
  }
}

function startEditDescription() {
  if (!isAdmin.value)
    return
  descriptionDraft.value = album.value?.description ?? ''
  editingDescription.value = true
}

async function saveDescription() {
  if (!album.value)
    return
  editingDescription.value = false
  const trimmed = descriptionDraft.value.trim()
  if (trimmed === (album.value.description ?? ''))
    return

  try {
    const updated = await updateAlbum(album.value.id, { description: trimmed })
    album.value = { ...album.value, ...updated }
  }
  catch (error) {
    toast.add({ title: translateError(error), color: 'error' })
  }
}

async function onToggleLike(photo: Photo) {
  try {
    const updated = await toggleLike(photo)
    updatePhoto(updated)
  }
  catch (error) {
    toast.add({ title: translateError(error), color: 'error' })
  }
}

async function handleFiles(fileList: FileList | null) {
  if (!fileList || !album.value)
    return
  for (const file of Array.from(fileList)) {
    if (file.type.startsWith('image/')) {
      const photo = await queueUpload(file)
      if (photo)
        prependPhoto(photo)
    }
  }
}
</script>

<template>
  <div>
    <BaseDropzone @drop="($event) => isAdmin && handleFiles($event)">
      <p v-if="pending" class="text-center text-sm text-gray-500 dark:text-gray-300">
        {{ t('loading') }}
      </p>

      <div v-else-if="album" class="flex flex-1 flex-col justify-baseline gap-y-2 mb-5">
        <div class="flex gap-x-1 items-baseline">
          <NuxtLink
            to="/albums"
            class="text-xl font-semibold"
          >
            {{ tg('common.nav.albums') }}
          </NuxtLink>

          <Icon name="ph:greater-than" />

          <UInput
            v-if="editingTitle"
            v-model="titleDraft"
            autofocus
            name="title"
            type="text"
            size="xl"
            variant="none"
            :ui="{ base: 'text-xl font-semibold text-inherit p-0' }"
            @keyup.enter="saveTitle"
            @keyup.esc="editingTitle = false"
            @blur="saveTitle"
          />

          <button
            v-else
            type="button"
            class="w-fit text-left text-xl font-semibold"
            @click="startEditTitle"
          >
            {{ album.title }}
          </button>

          <UAvatarGroup size="sm" :max="5" class="ml-auto">
            <UTooltip
              v-for="collaborator in album?.collaborators"
              :key="collaborator.id"
              :text="`${collaborator.first_name} ${collaborator.last_name}`"
            >
              <UAvatar
                :src="collaborator.avatar_url ?? undefined"
                :alt="`${collaborator.first_name} ${collaborator.last_name}`"
              />
            </UTooltip>
          </UAvatarGroup>
        </div>

        <textarea
          v-if="editingDescription"
          v-model="descriptionDraft"
          autofocus
          rows="2"
          name="description"
          class="w-full max-w-md rounded border-none text-sm focus-visible:outline-none focus-visible:ring focus-visible:ring-green-600 bg-white dark:bg-gray-800"
          @keyup.esc="editingDescription = false"
          @blur="saveDescription"
        />
        <button
          v-else
          type="button"
          class="w-fit text-left text-sm text-gray-500 dark:text-gray-300"
          @click="startEditDescription"
        >
          {{ album.description || t('addDescriptionPlaceholder') }}
        </button>
      </div>

      <PhotoUploads v-if="uploads.length" :uploads />

      <div v-if="album && !displayedPhotos.length && !gridLoading" class="py-20 text-center text-gray-500 dark:text-gray-300">
        <p v-if="isSearching">
          {{ t('noResults') }}
        </p>
        <p v-else>
          {{ t('emptyAlbum') }}
        </p>
      </div>

      <BaseVirtualGrid
        v-if="album"
        :items="displayedPhotos"
        :item-key="(photo: Photo) => photo.id"
        :has-more="gridHasMore"
        :loading="gridLoading"
        :breakpoints="breakpoints"
        @load-more="fetchNextPhotosPage"
      >
        <template #default="{ item: photo }">
          <BaseGalleryPhoto
            :photo="photo"
            :is-selected="selectedIds.has(photo.id)"
            :selection-mode="selectionMode"
            @toggle-selection="toggleSelection"
            @toggle-like="onToggleLike"
            @click="detailsPhotoId = photo.id"
          />
        </template>

        <template #loading>
          <p class="text-center text-sm text-gray-500 dark:text-gray-300">
            {{ t('loading') }}
          </p>
        </template>
      </BaseVirtualGrid>
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
  </div>
</template>

<i18n lang="json">
{
  "en": {
    "loading": "Loading…",
    "noResults": "No photos match your search.",
    "addDescriptionPlaceholder": "Add a description",
    "emptyAlbum": "This album is empty — add some photos to get started."
  }
}
</i18n>
