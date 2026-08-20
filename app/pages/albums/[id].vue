<script setup lang="ts">
import type { AlbumFull } from '~/composables/useAlbums'

definePageMeta({ middleware: ['auth'] })

const route = useRoute()
const router = useRouter()
const albumId = computed(() => Number(route.params.id))

const { user } = useCurrentUser()
const { fetchAlbum, updateAlbum, deleteAlbum, addPhotoToAlbum, removePhotoFromAlbum } = useAlbums()
const { photos: libraryPhotos, fetchNextPage: fetchNextLibraryPage, hasMore: libraryHasMore, loading: libraryLoading } = usePhotoLibrary()
const { addError, addSuccess } = useAlerts()
const { close: closePicker, open: openPicker } = useModal('add-photo-to-album')
const { close: closeDeleteModal, open: openDeleteModal } = useModal('delete-album')

const album = ref<AlbumFull | null>(null)
const loading = ref(true)
const editingTitle = ref(false)
const editingDescription = ref(false)
const titleDraft = ref('')
const descriptionDraft = ref('')
const savingPhotoId = ref<number | null>(null)
const deleting = ref(false)

const isAdmin = computed(() => !!album.value && !!user.value && album.value.admin.id === user.value.id)
const albumPhotoIds = computed(() => new Set(album.value?.photos.map(photo => photo.id) ?? []))

async function loadAlbum() {
  loading.value = true
  try {
    album.value = await fetchAlbum(albumId.value)
  }
  catch (error) {
    addError(translateError(error))
    await router.push('/albums')
  }
  finally {
    loading.value = false
  }
}

function startEditTitle() {
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
    addError(translateError(error))
  }
}

function startEditDescription() {
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
    addError(translateError(error))
  }
}

async function confirmDelete() {
  if (!album.value)
    return
  deleting.value = true
  try {
    await deleteAlbum(album.value.id)
    addSuccess('Album deleted.')
    await router.push('/albums')
  }
  catch (error) {
    addError(translateError(error))
  }
  finally {
    deleting.value = false
    closeDeleteModal()
  }
}

async function togglePhoto(photoId: number) {
  if (!album.value)
    return
  savingPhotoId.value = photoId
  try {
    album.value = albumPhotoIds.value.has(photoId)
      ? await removePhotoFromAlbum(album.value.id, photoId)
      : await addPhotoToAlbum(album.value.id, photoId)
  }
  catch (error) {
    addError(translateError(error))
  }
  finally {
    savingPhotoId.value = null
  }
}

async function openAddPhotoPicker() {
  openPicker()
  if (!libraryPhotos.value.length)
    await fetchNextLibraryPage()
}

onMounted(loadAlbum)
</script>

<template>
  <div class="mx-auto flex max-w-5xl flex-col gap-y-8 py-10">
    <p v-if="loading" class="text-center text-sm text-slate-500 dark:text-slate-300">
      Loading…
    </p>

    <template v-else-if="album">
      <div class="flex items-start justify-between gap-x-4">
        <div class="flex flex-1 flex-col gap-y-2">
          <input
            v-if="editingTitle"
            v-model="titleDraft"
            autofocus
            class="h-10 w-full max-w-md rounded border-none bg-white px-3 text-xl font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 dark:bg-slate-700"
            @keyup.enter="saveTitle"
            @keyup.esc="editingTitle = false"
            @blur="saveTitle"
          >
          <button v-else type="button" class="w-fit text-left text-xl font-semibold hover:underline" @click="startEditTitle">
            {{ album.title }}
          </button>

          <textarea
            v-if="editingDescription"
            v-model="descriptionDraft"
            autofocus
            rows="2"
            class="w-full max-w-md rounded border-none bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 dark:bg-slate-700"
            @keyup.esc="editingDescription = false"
            @blur="saveDescription"
          />
          <button
            v-else
            type="button"
            class="w-fit text-left text-sm text-slate-500 hover:underline dark:text-slate-300"
            @click="startEditDescription"
          >
            {{ album.description || 'Add a description' }}
          </button>
        </div>

        <div class="flex shrink-0 gap-x-2">
          <button
            type="button"
            class="flex h-10 items-center gap-x-2 rounded bg-green-500 px-4 font-medium text-white hover:bg-green-600"
            @click="openAddPhotoPicker"
          >
            <Icon name="ph:plus" size="1.1em" />
            Add photos
          </button>
          <button
            v-if="isAdmin"
            type="button"
            class="flex h-10 items-center gap-x-2 rounded bg-slate-200 px-4 font-medium text-red-500 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600"
            @click="openDeleteModal"
          >
            <Icon name="ph:trash" size="1.1em" />
            Delete
          </button>
        </div>
      </div>

      <div v-if="!album.photos.length" class="py-20 text-center text-slate-500 dark:text-slate-300">
        <p>This album is empty — add some photos to get started.</p>
      </div>

      <div v-else class="grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-6">
        <div v-for="photo in album.photos" :key="photo.id" class="group relative aspect-square overflow-hidden rounded">
          <img :src="photo.url" :alt="`Photo ${photo.id}`" class="h-full w-full object-cover" loading="lazy">
          <button
            type="button"
            title="Remove from album"
            :disabled="savingPhotoId === photo.id"
            class="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/50 text-white opacity-0 transition-opacity group-hover:opacity-100 disabled:opacity-50"
            @click="togglePhoto(photo.id)"
          >
            <Icon name="ph:x-bold" />
          </button>
        </div>
      </div>
    </template>

    <AppModal name="delete-album">
      <div class="flex flex-col gap-y-6">
        <h2 class="text-lg font-semibold">
          Delete this album
        </h2>
        <p>This action is irreversible. Photos in this album stay in your library. Are you sure?</p>
        <div class="flex justify-end gap-3">
          <button type="button" class="h-10 rounded bg-slate-200 px-4 font-medium hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600" @click="closeDeleteModal">
            Cancel
          </button>
          <button type="button" :disabled="deleting" class="h-10 rounded bg-red-500 px-4 font-medium text-white hover:bg-red-600 disabled:opacity-50" @click="confirmDelete">
            {{ deleting ? 'Deleting…' : 'Delete' }}
          </button>
        </div>
      </div>
    </AppModal>

    <AppModal name="add-photo-to-album">
      <div class="flex max-h-[80vh] flex-col gap-y-4">
        <h2 class="text-lg font-semibold">
          Add photos to album
        </h2>

        <div v-if="!libraryPhotos.length && !libraryLoading" class="py-10 text-center text-slate-500 dark:text-slate-300">
          <p>Your photo library is empty.</p>
        </div>

        <div class="grid grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
          <button
            v-for="photo in libraryPhotos"
            :key="photo.id"
            type="button"
            :disabled="savingPhotoId === photo.id"
            class="group relative aspect-square overflow-hidden rounded disabled:opacity-50"
            @click="togglePhoto(photo.id)"
          >
            <img :src="photo.url" :alt="`Photo ${photo.id}`" class="h-full w-full object-cover">
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
          {{ libraryLoading ? 'Loading…' : 'Load more' }}
        </button>

        <button
          type="button"
          class="mt-2 h-10 rounded bg-slate-200 px-4 font-medium hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600"
          @click="closePicker"
        >
          Done
        </button>
      </div>
    </AppModal>
  </div>
</template>
