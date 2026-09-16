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
  // Ctrl/Cmd + Plus/Minus/0 are the other native page-zoom trigger. Some
  // browsers reserve these as OS-level shortcuts a page can't override, but
  // this still blocks it wherever the browser does allow prevention.
  else if ((event.ctrlKey || event.metaKey) && ['+', '-', '=', '0'].includes(event.key))
    event.preventDefault()
}

async function downloadPhoto(photo: Photo) {
  await downloadFile(photo.url, getPhotoFileName(photo))
}

function formatExpiry(date: string) {
  return new Date(date).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

// Photo zoom: pinch/ctrl+scroll to zoom, drag to pan once zoomed. Two
// phases, so small photos (whose fitted size is much smaller than the
// available viewing area) still feel like they're being "zoomed" rather
// than just cropped in place:
//   1. Growth — the photo's own box grows (real layout resize, so no
//      cropping is needed) up to the viewing area's ceiling (85vw/75vh, the
//      same bounds `max-w-full`/`max-h-[75vh]` already cap it to at rest).
//      A photo already at/above that size (the common case) skips straight
//      past this phase (`effectiveMaxScale` is 1).
//   2. Crop — once the photo box is maxed out, further zoom scales/pans the
//      image *inside* that now-fixed box. CSS `transform` never affects an
//      element's own layout box, so the `overflow-hidden` wrapper clips the
//      scaled/panned image back to that fixed box for free.
const MIN_SCALE = 1
// How far beyond the maxed-out viewing area a photo can still be cropped
// into for extra detail (e.g. a large photo already filling the viewing
// area at rest can still be crop-zoomed up to 3x that).
const MAX_CROP_SCALE = 3

const zoomBoxRef = useTemplateRef('zoomBoxRef')
const scale = shallowRef(MIN_SCALE)
const translateX = shallowRef(0)
const translateY = shallowRef(0)
const isPanning = shallowRef(false)
// The photo's own fitted (unzoomed) render size, measured lazily off the
// wrapper the first time this photo is zoomed (see `ensureNaturalSize`).
// `null` until then, in which case the wrapper/image fall back to their
// plain "fit to the viewing area" CSS sizing (see the template).
const naturalSize = shallowRef<{ width: number, height: number } | null>(null)

const effectiveMaxScale = computed(() => {
  if (!naturalSize.value)
    return MIN_SCALE
  const maxWidth = window.innerWidth * 0.85
  const maxHeight = window.innerHeight * 0.75
  return Math.max(MIN_SCALE, Math.min(maxWidth / naturalSize.value.width, maxHeight / naturalSize.value.height))
})

// The portion of `scale` spent actually cropping into the image (as opposed
// to growing its box) — 1 until the photo's box has maxed out.
function cropScaleOf(rawScale: number) {
  return rawScale > effectiveMaxScale.value ? rawScale / effectiveMaxScale.value : MIN_SCALE
}

const boxStyle = computed(() => {
  if (!naturalSize.value)
    return {}
  const growth = Math.min(scale.value, effectiveMaxScale.value)
  return { width: `${naturalSize.value.width * growth}px`, height: `${naturalSize.value.height * growth}px` }
})

const imageStyle = computed(() => ({
  transform: `translate(${translateX.value}px, ${translateY.value}px) scale(${cropScaleOf(scale.value)})`,
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
  naturalSize.value = null
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

// Measures the photo's plain fitted size, once per photo, right before its
// first zoom interaction — at that point nothing has overridden the
// wrapper's CSS-driven "fit to viewing area" sizing yet, so this is exactly
// the size to grow from.
function ensureNaturalSize() {
  if (naturalSize.value)
    return
  const box = zoomBoxRef.value?.getBoundingClientRect()
  if (box && box.width > 0 && box.height > 0)
    naturalSize.value = { width: box.width, height: box.height }
}

function isZoomedIn() {
  return cropScaleOf(scale.value) > MIN_SCALE
}

// The pannable range shrinks/grows with the current crop scale, against the
// wrapper's own (untransformed — CSS `transform` doesn't affect layout)
// maxed-out box.
function clampOffsets(x: number, y: number) {
  const box = zoomBoxRef.value?.getBoundingClientRect()
  if (!box)
    return { x: 0, y: 0 }
  const cropScale = cropScaleOf(scale.value)
  const maxOffsetX = (cropScale - 1) * box.width / 2
  const maxOffsetY = (cropScale - 1) * box.height / 2
  return { x: clamp(x, -maxOffsetX, maxOffsetX), y: clamp(y, -maxOffsetY, maxOffsetY) }
}

function applyZoom(nextScale: number) {
  ensureNaturalSize()
  const previousCropScale = cropScaleOf(scale.value)
  scale.value = clamp(nextScale, MIN_SCALE, effectiveMaxScale.value * MAX_CROP_SCALE)
  // Keep the current pan proportionally in range as the crop scale shrinks,
  // and snap back to centered once fully zoomed out.
  const ratio = cropScaleOf(scale.value) / previousCropScale
  const clamped = clampOffsets(translateX.value * ratio, translateY.value * ratio)
  translateX.value = clamped.x
  translateY.value = clamped.y
}

function pan(deltaX: number, deltaY: number) {
  const clamped = clampOffsets(translateX.value + deltaX, translateY.value + deltaY)
  translateX.value = clamped.x
  translateY.value = clamped.y
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

interface DragStart { x: number, y: number, translateX: number, translateY: number }

let dragStart: DragStart | null = null

function onMouseMove(event: MouseEvent) {
  if (!dragStart)
    return
  translateX.value = dragStart.translateX
  translateY.value = dragStart.translateY
  pan(event.clientX - dragStart.x, event.clientY - dragStart.y)
}

function stopMousePan() {
  isPanning.value = false
  dragStart = null
  window.removeEventListener('mousemove', onMouseMove)
  window.removeEventListener('mouseup', stopMousePan)
}

function onMouseDown(event: MouseEvent) {
  if (!isZoomedIn() || event.button !== 0)
    return
  event.preventDefault()
  isPanning.value = true
  dragStart = { x: event.clientX, y: event.clientY, translateX: translateX.value, translateY: translateY.value }
  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', stopMousePan)
}

// Guards against a leaked `window` listener if the modal is closed (the
// component unmounts) mid-drag, e.g. pressing Escape while panning.
onUnmounted(stopMousePan)

function touchDistance(touches: TouchList) {
  const [a, b] = [touches[0]!, touches[1]!]
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
}

// Two-finger touches are also prevented at the modal root (`onModalTouchMove`
// below), not just over the photo, so pinching anywhere in the modal never
// falls through to the browser's native page zoom.
let pinchStartDistance = 0
let pinchStartScale = MIN_SCALE
let panStart: DragStart | null = null

function onTouchStart(event: TouchEvent) {
  if (event.touches.length === 2) {
    event.preventDefault()
    panStart = null
    pinchStartDistance = touchDistance(event.touches)
    pinchStartScale = scale.value
  }
  else if (event.touches.length === 1 && isZoomedIn()) {
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

// Blocks native pinch-zoom anywhere in the modal (buttons, background),
// not just over the photo — the photo itself still only zooms via
// `onTouchMove` above, scoped to `zoomBoxRef`.
function onModalTouchMove(event: TouchEvent) {
  if (event.touches.length >= 2)
    event.preventDefault()
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
    @touchmove="onModalTouchMove"
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
        :class="[isZoomedIn() ? (isPanning ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-zoom-in']"
        :style="boxStyle"
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
          :class="naturalSize ? 'h-full w-full object-contain' : 'max-h-[75vh] max-w-full object-contain'"
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
