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
}>()

const { t } = useI18n({ useScope: 'local', inheritLocale: true })

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
</script>

<template>
  <div class="group relative aspect-square overflow-hidden rounded">
    <button
      type="button"
      class="absolute inset-0"
      @click="onPhotoClick(photo, $event)"
    >
      <BaseImg :src="photo.url" :alt="getPhotoFileName(photo)" />
    </button>

    <button
      type="button"
      :title="t('select')"
      class="absolute left-2 top-2 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-black/30 transition-opacity"
      :class="isSelected ? 'bg-green-500 opacity-100' : 'opacity-0 group-hover:opacity-100'"
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
    "select": "Select"
  }
}
</i18n>
