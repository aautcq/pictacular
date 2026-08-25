<script setup lang="ts">
import type { Photo } from '~/composables/usePhotoLibrary'
import { useFocusTrap } from '@vueuse/integrations/useFocusTrap'

const { photo, hasPrevious, hasNext } = defineProps<{
  photo: Photo
  hasPrevious: boolean
  hasNext: boolean
}>()

const emit = defineEmits<{
  showPrevious: []
  showNext: []
  toggleLike: [photo: Photo]
  close: []
}>()

const { t } = useI18n({ useScope: 'local', inheritLocale: true })
const { t: tg } = useI18n({ useScope: 'global' })

const detailsRef = useTemplateRef('detailsRef')
useFocusTrap(detailsRef, { immediate: true })

function onDetailsKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowLeft' && hasPrevious)
    emit('showPrevious')
  else if (event.key === 'ArrowRight' && hasNext)
    emit('showNext')
}

async function downloadPhoto(photo: Photo) {
  await downloadFile(photo.url, getPhotoFileName(photo))
}
</script>

<template>
  <div
    ref="detailsRef"
    class="fixed inset-0 z-40 flex items-center justify-center bg-black/80"
    @keydown="onDetailsKeydown"
    @keydown.esc="emit('close')"
    @click.self="emit('close')"
  >
    <button
      type="button"
      class="absolute right-4 top-4 text-white"
      :aria-label="tg('common.close')"
      @click="emit('close')"
    >
      <Icon name="ph:x" size="1.5em" />
    </button>

    <button
      v-if="hasPrevious"
      type="button"
      class="absolute left-4 text-white"
      :aria-label="t('previousPhoto')"
      @click="hasPrevious && emit('showPrevious')"
    >
      <Icon name="ph:caret-left" size="2em" />
    </button>

    <div class="flex max-h-[85vh] max-w-[85vw] flex-col items-center gap-y-4">
      <BaseImg
        :src="photo.url"
        :alt="t('photoAlt', { id: photo.id })"
        class="max-h-[75vh] max-w-full rounded object-contain"
      />
      <div class="flex items-center gap-x-4">
        <button type="button" class="flex items-center gap-x-1 text-white" @click="emit('toggleLike', photo)">
          <Icon :name="photo.liked ? 'ph:heart-fill' : 'ph:heart'" :class="photo.liked && 'text-red-500'" />
          {{ photo.liked ? t('liked') : t('like') }}
        </button>
        <button type="button" class="flex items-center gap-x-1 text-white" @click="downloadPhoto(photo)">
          <Icon name="ph:download-simple" />
          {{ t('download') }}
        </button>
      </div>
    </div>

    <button
      v-if="hasNext"
      type="button"
      class="absolute right-4 text-white"
      :aria-label="t('nextPhoto')"
      @click="hasNext && emit('showNext')"
    >
      <Icon name="ph:caret-right" size="2em" />
    </button>
  </div>
</template>

<i18n lang="json">
{
  "en": {
    "photoAlt": "Photo {id}",
    "previousPhoto": "Previous photo",
    "nextPhoto": "Next photo",
    "liked": "Liked",
    "like": "Like",
    "download": "Download"
  }
}
</i18n>
