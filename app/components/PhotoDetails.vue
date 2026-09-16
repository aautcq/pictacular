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
  restore: [photo: Photo]
  close: []
}>()

const { t } = useI18n({ useScope: 'local', inheritLocale: true })
const { t: tg } = useI18n({ useScope: 'global' })

const detailsRef = useTemplateRef('detailsRef')
useFocusTrap(detailsRef, { immediate: true })

function onDetailsKeydown(event: KeyboardEvent) {
  // Arrow keys always navigate photos, even while zoomed in — panning is
  // drag-only, so it never competes with photo navigation.
  if (event.key === 'ArrowLeft' && hasPrevious)
    emit('showPrevious')
  else if (event.key === 'ArrowRight' && hasNext)
    emit('showNext')
}

async function downloadPhoto(photo: Photo) {
  await downloadFile(photo.url, getPhotoFileName(photo))
}

function formatExpiry(date: string) {
  return new Date(date).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

// Photo zoom: pinch/ctrl+scroll to zoom (1x-3x), drag to pan once zoomed.
// CSS `transform` never affects an element's own layout box, so the
// `overflow-hidden` wrapper below clips the scaled/panned image back to its
// original fitted size for free — no manual bounds measurement needed.
const MIN_SCALE = 1
const MAX_SCALE = 3

const zoomBoxRef = useTemplateRef('zoomBoxRef')
const scale = shallowRef(MIN_SCALE)
const translateX = shallowRef(0)
const translateY = shallowRef(0)
const isPanning = shallowRef(false)

const imageStyle = computed(() => ({
  transform: `translate(${translateX.value}px, ${translateY.value}px) scale(${scale.value})`,
  transition: isPanning.value ? 'none' : 'transform 0.15s ease-out',
}))

// Reset zoom whenever the displayed photo changes (prev/next navigation);
// closing and reopening the modal resets it for free since the component
// unmounts (see `v-if="detailsPhoto"` in the pages that render it).
watch(() => photo.id, resetZoom)

function resetZoom() {
  scale.value = MIN_SCALE
  translateX.value = 0
  translateY.value = 0
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function applyZoom(nextScale: number) {
  const previousScale = scale.value
  scale.value = clamp(nextScale, MIN_SCALE, MAX_SCALE)
  // Keep the current pan proportionally in range as scale shrinks, and
  // snap back to centered once fully zoomed out.
  const box = zoomBoxRef.value?.getBoundingClientRect()
  if (!box)
    return
  const maxOffsetX = (scale.value - 1) * box.width / 2
  const maxOffsetY = (scale.value - 1) * box.height / 2
  const ratio = previousScale === scale.value ? 1 : scale.value / previousScale
  translateX.value = clamp(translateX.value * ratio, -maxOffsetX, maxOffsetX)
  translateY.value = clamp(translateY.value * ratio, -maxOffsetY, maxOffsetY)
}

function pan(deltaX: number, deltaY: number) {
  const box = zoomBoxRef.value?.getBoundingClientRect()
  if (!box)
    return
  const maxOffsetX = (scale.value - 1) * box.width / 2
  const maxOffsetY = (scale.value - 1) * box.height / 2
  translateX.value = clamp(translateX.value + deltaX, -maxOffsetX, maxOffsetX)
  translateY.value = clamp(translateY.value + deltaY, -maxOffsetY, maxOffsetY)
}

// Trackpad pinch and Ctrl/Cmd+scroll-wheel both surface as `wheel` events
// with `ctrlKey: true` — intercepted (and prevented) on the whole modal so
// the browser's own page zoom never triggers while it's open.
function onWheel(event: WheelEvent) {
  if (!event.ctrlKey)
    return
  event.preventDefault()
  applyZoom(scale.value * Math.exp(-event.deltaY * 0.01))
}

function onMouseDown(event: MouseEvent) {
  if (scale.value <= MIN_SCALE || event.button !== 0)
    return
  event.preventDefault()
  isPanning.value = true
  const startX = event.clientX
  const startY = event.clientY
  const startTranslateX = translateX.value
  const startTranslateY = translateY.value

  function onMouseMove(moveEvent: MouseEvent) {
    translateX.value = startTranslateX
    translateY.value = startTranslateY
    pan(moveEvent.clientX - startX, moveEvent.clientY - startY)
  }
  function onMouseUp() {
    isPanning.value = false
    window.removeEventListener('mousemove', onMouseMove)
    window.removeEventListener('mouseup', onMouseUp)
  }
  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)
}

function touchDistance(touches: TouchList) {
  const [a, b] = [touches[0]!, touches[1]!]
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
}

let pinchStartDistance = 0
let pinchStartScale = MIN_SCALE
let panStart: { x: number, y: number, translateX: number, translateY: number } | null = null

function onTouchStart(event: TouchEvent) {
  if (event.touches.length === 2) {
    event.preventDefault()
    panStart = null
    pinchStartDistance = touchDistance(event.touches)
    pinchStartScale = scale.value
  }
  else if (event.touches.length === 1 && scale.value > MIN_SCALE) {
    const touch = event.touches[0]!
    panStart = { x: touch.clientX, y: touch.clientY, translateX: translateX.value, translateY: translateY.value }
  }
}

function onTouchMove(event: TouchEvent) {
  if (event.touches.length === 2 && pinchStartDistance > 0) {
    event.preventDefault()
    applyZoom(pinchStartScale * (touchDistance(event.touches) / pinchStartDistance))
  }
  else if (event.touches.length === 1 && panStart) {
    event.preventDefault()
    const touch = event.touches[0]!
    translateX.value = panStart.translateX
    translateY.value = panStart.translateY
    pan(touch.clientX - panStart.x, touch.clientY - panStart.y)
  }
}

function onTouchEnd(event: TouchEvent) {
  if (event.touches.length < 2)
    pinchStartDistance = 0
  if (event.touches.length < 1)
    panStart = null
}
</script>

<template>
  <div
    ref="detailsRef"
    class="fixed inset-0 z-40 flex items-center justify-center bg-black/80"
    @keydown="onDetailsKeydown"
    @keydown.esc="emit('close')"
    @click.self="emit('close')"
    @wheel="onWheel"
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
      <div
        v-if="photo.archived_state === 'archived' || photo.archived_state === 'restoring'"
        class="flex h-[50vh] w-[50vw] max-w-md flex-col items-center justify-center gap-y-4 rounded bg-white/10 text-white"
      >
        <Icon :name="photo.archived_state === 'restoring' ? 'ph:cloud-arrow-down' : 'ph:archive'" size="3em" />
        <p>{{ photo.archived_state === 'restoring' ? t('restoring') : t('archived') }}</p>
        <UButton
          v-if="photo.archived_state === 'archived'"
          type="button"
          :label="t('restore')"
          color="neutral"
          variant="soft"
          @click="emit('restore', photo)"
        />
      </div>
      <div
        v-else
        ref="zoomBoxRef"
        class="touch-none select-none overflow-hidden rounded"
        :class="[scale > 1 ? (isPanning ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-zoom-in']"
        @mousedown="onMouseDown"
        @touchstart="onTouchStart"
        @touchmove="onTouchMove"
        @touchend="onTouchEnd"
        @touchcancel="onTouchEnd"
      >
        <BaseImg
          :src="photo.url"
          :alt="t('photoAlt', { id: photo.id })"
          :width="2048"
          :height="2048"
          fit="inside"
          class="max-h-[75vh] max-w-full object-contain"
          :style="imageStyle"
        />
      </div>
      <p v-if="photo.archived_state === 'restored' && photo.restore_expires_at" class="text-xs text-gray-300">
        {{ t('availableUntil', { date: formatExpiry(photo.restore_expires_at) }) }}
      </p>
      <div class="flex items-center gap-x-4">
        <button type="button" class="flex items-center gap-x-1 text-white" @click="emit('toggleLike', photo)">
          <Icon :name="photo.liked ? 'ph:heart-fill' : 'ph:heart'" :class="photo.liked && 'text-red-500'" />
          {{ photo.liked ? t('liked') : t('like') }}
        </button>
        <button
          v-if="photo.archived_state !== 'archived' && photo.archived_state !== 'restoring'"
          type="button"
          class="flex items-center gap-x-1 text-white"
          @click="downloadPhoto(photo)"
        >
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
    "download": "Download",
    "archived": "This photo is archived and currently unavailable.",
    "restoring": "This photo is being restored. This can take a few hours.",
    "restore": "Restore",
    "availableUntil": "Available until {date}"
  }
}
</i18n>
