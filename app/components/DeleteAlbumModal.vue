<script setup lang="ts">
import type { AlbumFull } from '~/composables/useAlbums'

const { album } = defineProps<{ album: AlbumFull }>()
const isOpen = defineModel<boolean>('isOpen', { required: true })

const { deleteAlbum } = useAlbums()
const toast = useToast()
const { translateError } = useErrorMessage()
const { t } = useI18n({ useScope: 'local', inheritLocale: true })

const deleting = shallowRef(false)

async function confirmDelete() {
  deleting.value = true
  try {
    await deleteAlbum(album.id)
    toast.add({ title: t('albumDeleted') })
    await navigateTo('/albums')
  }
  catch (error) {
    toast.add({ title: translateError(error), color: 'error' })
  }
  finally {
    deleting.value = false
    isOpen.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="isOpen"
    :title="t('deleteModalTitle')"
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
        :label="deleting ? t('deleting') : t('deleteButton')"
        color="error"
        @click="confirmDelete"
      />
    </template>
  </UModal>
</template>

<i18n lang="json">
{
  "en": {
    "deleteModalTitle": "Delete this album",
    "deleteModalBody": "This action is irreversible. Photos in this album stay in your library. Are you sure?",
    "cancel": "Cancel",
    "deleteButton": "Delete",
    "deleting": "Deleting…",
    "close": "Close",
    "albumDeleted": "Album deleted."
  }
}
</i18n>
