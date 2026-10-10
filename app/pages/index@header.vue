<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'

const { translateError } = useErrorMessage()
const { t } = useI18n({ useScope: 'local', inheritLocale: true })
const {
  photos,
  searchPhotos,
  addUploadedPhoto,
  deletePhotos,
  restoreArchivedPhotos,
} = usePhotoLibrary()
const { query, results: searchResults } = useSearch('library', searchPhotos)
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
  selectedCount,
  selectionMode,
  clearSelection,
  downloadSelected,
} = usePhotoGallery('library', displayedPhotos)
const { handleFiles } = usePhotoUpload('library', addUploadedPhoto)
const toast = useToast()

const deleting = shallowRef(false)
const restoringAll = shallowRef(false)

const isAddToAlbumModalOpen = shallowRef(false)
const isDeleteModalOpen = shallowRef(false)

const hasArchivedPhotos = computed(() => photos.value.some(photo => photo.archived_state === 'archived'))

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
</script>

<template>
  <div class="flex items-center gap-x-2">
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

    <BaseSearchToggle
      v-if="!selectionMode"
      v-model="query"
      :label="t('searchLabel')"
      :placeholder="t('searchPlaceholder')"
    />

    <BaseFilesUpload @files-uploaded="handleFiles" />

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
  </div>
</template>

<i18n lang="json">
{
  "en": {
    "searchLabel": "Search photos",
    "searchPlaceholder": "Search photos…",
    "photosDeleted": "Photos deleted.",
    "settings": "Settings",
    "cancel": "Cancel",
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
