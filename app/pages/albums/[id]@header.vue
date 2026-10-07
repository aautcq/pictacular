<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'

const route = useRoute()
const albumId = computed(() => Number(route.params.id))

const { user } = useCurrentUser()
const { fetchAlbum, removePhotoFromAlbum } = useAlbums()
const { queueUpload } = usePhotoUpload()
const toast = useToast()
const { translateError } = useErrorMessage()
const { t } = useI18n({ useScope: 'local', inheritLocale: true })

const deleting = shallowRef(false)
const isDeleteModalOpen = shallowRef(false)
const isRemovePhotosModalOpen = shallowRef(false)
const isAddPhotoPickerOpen = shallowRef(false)
const isCollaboratorsModalOpen = shallowRef(false)
const isShareModalOpen = shallowRef(false)

const {
  photos,
  fetchNextPage: fetchNextPhotosPage,
  searchPhotos,
  prependPhoto,
  removePhoto,
} = useAlbumPhotos(albumId)

// Issue #170: an Album can hold thousands of Photos, so its metadata and
// its first page of Photos are two separate requests — run together
// rather than one after the other, so `pending` going false always means
// both the metadata and at least the first Photo page are ready.
const [{ data: album }] = await Promise.all([
  useAsyncData('album', async () => await fetchAlbum(albumId.value), { watch: [albumId] }),
  useAsyncData('album-photos', fetchNextPhotosPage),
])

// Issue #190: search scoped to this Album's own Photos (filename only —
// see useAlbumPhotos#searchPhotos). Same "search results replace the
// paginated grid" shape as the library page and albums/index.vue.
const { query, results: searchResults } = useSearch('album-detail', searchPhotos)
const displayedPhotos = computed(() => searchResults.value ?? photos.value)

const {
  selectedIds,
  selectedCount,
  selectionMode,
  clearSelection,
  downloadSelected,
} = usePhotoGallery('album-detail', displayedPhotos)

useHead({ title: computed(() => album.value?.title) })

const isAdmin = computed(() => !!album.value && !!user.value && album.value.admin.id === user.value.id)

async function confirmRemoveSelected() {
  deleting.value = true
  try {
    await Promise.all([...selectedIds.value].map(async (id) => {
      await removePhotoFromAlbum(albumId.value, id)
      removePhoto(id)
    }))
    toast.add({ title: t('photosDeleted') })
    clearSelection()
    isRemovePhotosModalOpen.value = false
  }
  catch (error) {
    toast.add({ title: translateError(error), color: 'error' })
  }
  finally {
    deleting.value = false
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

const settingsItems = computed<DropdownMenuItem[][]>(() => [
  [
    {
      label: t('addPhotosButton'),
      icon: 'ph:plus',
      onSelect: () => { isAddPhotoPickerOpen.value = true },
      visible: isAdmin.value,
    },
  ],
  [
    {
      label: t('shareButton'),
      icon: 'ph:share-network',
      onSelect: async () => { isShareModalOpen.value = true },
      visible: true,
    },
    {
      label: t('collaboratorsButton'),
      icon: 'ph:users',
      onSelect: () => { isCollaboratorsModalOpen.value = true },
      visible: isAdmin.value,
    },
  ],
  [
    {
      label: t('download'),
      icon: 'ph:download-simple',
      onSelect: () => { downloadSelected() },
      visible: selectionMode.value,
    },
    {
      label: t('remove'),
      icon: 'ph:trash-simple',
      color: 'warning',
      onSelect: () => { isRemovePhotosModalOpen.value = true },
      visible: selectionMode.value && isAdmin.value,
    },
  ],
  [
    {
      label: t('deleteModalTitle'),
      icon: 'ph:trash',
      color: 'error',
      onSelect: () => { isDeleteModalOpen.value = true },
      visible: isAdmin.value,
    },
  ],
].map(group => group?.filter(item => item.visible)).filter(group => group?.length > 0) as DropdownMenuItem[][])
</script>

<template>
  <div class="flex items-center gap-x-2">
    <HeaderSelectedMenu
      v-if="selectionMode"
      :selected-count="selectedCount"
      @cancel-selection="clearSelection"
    />

    <UDropdownMenu :items="settingsItems">
      <UTooltip :text="t('settings')">
        <UButton
          icon="ph:dots-three-vertical"
          color="neutral"
          variant="soft"
          :aria-label="t('settings')"
        />
      </UTooltip>
    </UDropdownMenu>

    <BaseSearchToggle
      v-if="!selectionMode"
      v-model="query"
      :label="t('searchLabel')"
      :placeholder="t('searchPlaceholder')"
    />

    <BaseFilesUpload v-if="isAdmin" @files-uploaded="handleFiles" />

    <CollaboratorsModal
      v-if="album"
      v-model:is-open="isCollaboratorsModalOpen"
      v-model="album"
    />

    <ShareModal
      v-if="isAdmin && album"
      v-model:is-open="isShareModalOpen"
      v-model="album"
    />

    <AddPhotoPickerModal
      v-if="album"
      v-model:is-open="isAddPhotoPickerOpen"
      :album-id="album.id"
      @photo-added="prependPhoto"
      @photo-removed="removePhoto"
    />

    <DeleteAlbumModal
      v-if="isAdmin && album"
      v-model:is-open="isDeleteModalOpen"
      :album
    />

    <UModal
      v-if="isAdmin"
      v-model:open="isRemovePhotosModalOpen"
      :title="t('removeModalTitle', selectedCount)"
      :description="t('removeModalBody')"
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
          :label="deleting ? t('removing') : t('remove')"
          color="error"
          @click="confirmRemoveSelected"
        />
      </template>
    </UModal>
  </div>
</template>

<i18n lang="json">
{
  "en": {
    "photosDeleted": "Photos deleted",
    "searchLabel": "Search photos",
    "searchPlaceholder": "Search photos…",
    "collaboratorsButton": "Collaborators",
    "shareButton": "Share",
    "settings": "Settings",
    "addPhotosButton": "Add photos from gallery",
    "cancel": "Cancel",
    "removeModalTitle": "Remove {count} photo | Remove {count} photos",
    "removeModalBody": "This action is irreversible. Are you sure?",
    "removing": "Removing…",
    "remove": "Remove photos",
    "download": "Download",
    "deleteModalTitle": "Delete this album"
  }
}
</i18n>
