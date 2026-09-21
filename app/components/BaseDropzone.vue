<script setup lang="ts">
const emit = defineEmits<{ drop: [value: FileList | null] }>()

const { t } = useI18n({ useScope: 'local', inheritLocale: true })

const dropzoneActive = shallowRef(false)

// dragenter/dragleave fire (and bubble) for every child element entered/left,
// not just the wrapper itself, so a plain boolean flickers as the pointer
// crosses over the slot's own content. Counting nested enter/leave pairs
// keeps the overlay stable until the pointer actually leaves the wrapper.
let dragDepth = 0

function onDragEnter() {
  dragDepth += 1
  dropzoneActive.value = true
}

function onDragLeave() {
  dragDepth -= 1
  if (dragDepth <= 0) {
    dragDepth = 0
    dropzoneActive.value = false
  }
}

function onDrop(event: DragEvent) {
  dragDepth = 0
  dropzoneActive.value = false
  emit('drop', event.dataTransfer?.files ?? null)
}
</script>

<template>
  <div
    @dragenter.prevent="onDragEnter"
    @dragover.prevent
    @dragleave.prevent="onDragLeave"
    @drop.prevent="onDrop"
  >
    <div
      v-if="dropzoneActive"
      class="pointer-events-none fixed inset-0 z-30 flex flex-col items-center justify-center gap-y-2 rounded-lg p-10 text-center text-sm text-gray-500 transition-colors dark:text-gray-300 bg-neutral-300/10 backdrop-blur-xs"
    >
      <Icon name="ph:image" size="3rem" />
      <p>{{ t('dropzoneHint') }}</p>
    </div>

    <slot />
  </div>
</template>

<i18n lang="json">
{
  "en": {
    "dropzoneHint": "Drag and drop photos here, or use the Upload photos button above."
  }
}
</i18n>
