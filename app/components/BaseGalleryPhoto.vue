<script setup lang="ts">
import type { Photo } from '~/composables/usePhotoLibrary'

const { photo, selectionMode } = defineProps<{
  photo: Photo
  selectionMode: boolean
  isSelected: boolean
}>()

const emit = defineEmits<{
  showPrevious: []
  showNext: []
  toggleLike: [photo: Photo]
  toggleSelection: [photo: Photo, event: MouseEvent]
  click: [photo: Photo, event: MouseEvent]
  restore: [photo: Photo]
}>()

const { t } = useI18n({ useScope: 'local', inheritLocale: true })
const { isMobileOrTablet } = useDevice()

// Clicking a photo either toggles its selection (once selection has
// started, or with Shift held for a range-select) or opens the details
// modal — matching the legacy List.vue's single/shift-select + click-to-open
// behavior.
function onPhotoClick(photo: Photo, event: MouseEvent) {
  if (selectionMode || event.shiftKey)
    emit('toggleSelection', photo, event)
  else
    emit('click', photo, event)
}

function formatExpiry(date: string) {
  return new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
</script>

<template>
  <div class="group relative aspect-square overflow-hidden rounded">
    <button
      type="button"
      class="absolute inset-0"
      @click="onPhotoClick(photo, $event)"
    >
      <!-- An Archived/restoring Photo's bytes aren't available from S3
           (issue #145), so a clear placeholder replaces the (otherwise
           broken-image) thumbnail instead of relying on BaseImg's generic
           load-error fallback, which gives no explanation. -->
      <div
        v-if="photo.archived_state === 'archived' || photo.archived_state === 'restoring'"
        class="flex h-full w-full flex-col items-center justify-center gap-y-2 bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-300"
      >
        <Icon :name="photo.archived_state === 'restoring' ? 'ph:cloud-arrow-down' : 'ph:archive'" size="2em" />
        <p class="text-xs font-light">
          {{ photo.archived_state === 'restoring' ? t('restoring') : t('archived') }}
        </p>
      </div>
      <BaseImg v-else :src="photo.url" :alt="getPhotoFileName(photo)" />
    </button>

    <button
      v-if="photo.archived_state === 'archived'"
      type="button"
      class="absolute bottom-2 left-1/2 -translate-x-1/2 rounded bg-black/60 px-2 py-1 text-xs text-white"
      @click.stop="emit('restore', photo)"
    >
      {{ t('restore') }}
    </button>

    <UBadge
      v-if="photo.archived_state === 'restored' && photo.restore_expires_at"
      color="warning"
      variant="subtle"
      size="sm"
      class="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2"
      :label="t('availableUntil', { date: formatExpiry(photo.restore_expires_at) })"
    />

    <button
      type="button"
      :title="t('select')"
      class="absolute left-2 top-2 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-black/30 transition-opacity"
      :class="isSelected ? 'bg-green-500 opacity-100' : isMobileOrTablet ? '' : 'opacity-0 group-hover:opacity-100'"
      @click.stop="emit('toggleSelection', photo, $event)"
    >
      <Icon v-if="isSelected" name="ph:check-bold" class="text-white" />
    </button>

    <Icon
      v-if="photo.liked"
      name="ph:heart-fill"
      class="pointer-events-none absolute right-2 top-2 text-red-500"
    />
  </div>
</template>

<i18n lang="json">
{
  "en": {
    "select": "Select",
    "archived": "Archived",
    "restoring": "Restoring…",
    "restore": "Restore",
    "availableUntil": "Available until {date}"
  }
}
</i18n>
