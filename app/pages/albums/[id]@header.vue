<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'

const route = useRoute()
const albumId = computed(() => Number(route.params.id))

const { user } = useCurrentUser()
const { fetchAlbum, removePhotoFromAlbum } = useAlbums()
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

const { handleFiles: uploadFiles } = usePhotoUpload('album-detail', prependPhoto)

// Same 'album'/'album-photos' useAsyncData keys as albums/[id].vue, so this
// shares that component's fetch rather than re-requesting — but, unlike the
// page, this header doesn't gate anything on `pending` (everything below is
// already guarded by `v-if="album"`), so it doesn't need to await the fetch
// itself. Awaiting it here too would make this component async-setup as
// well, which — paired with the page component also being async-setup for
// the same route — can trip a Vue/Suspense edge case where sibling async
// components under separate Suspense boundaries leak internal render state,
// producing a spurious "Slot invoked outside of the render function"
// warning (https://github.com/vuejs/core/issues/14667).
const { data: album } = useAsyncData('album', async () => await fetchAlbum(albumId.value), { watch: [albumId] })
useAsyncData('album-photos', fetchNextPhotosPage)

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
  if (!album.value)
    return
  await uploadFiles(fileList)
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
      label: t('remove', selectedCount.value),
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
      :description="t('removeModalBody', selectedCount)"
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
          :label="deleting ? t('removing') : t('remove', selectedCount)"
          color="warning"
          @click="confirmRemoveSelected"
        />
      </template>
    </UModal>
  </div>
</template>

<i18n lang="json">
{
  "en": {
    "photosDeleted": "Photos removed",
    "searchLabel": "Search photos",
    "searchPlaceholder": "Search photos…",
    "collaboratorsButton": "Collaborators",
    "shareButton": "Share",
    "settings": "Settings",
    "addPhotosButton": "Add photos from gallery",
    "cancel": "Cancel",
    "removeModalTitle": "Remove {count} photo | Remove {count} photos",
    "removeModalBody": "You are about to remove this photo from the album. Are you sure? | You are about to remove these photo from the album. Are you sure?",
    "removing": "Removing…",
    "remove": "Remove photo | Remove photos",
    "download": "Download",
    "deleteModalTitle": "Delete this album"
  }
}
</i18n>
