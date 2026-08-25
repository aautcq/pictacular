<script setup lang="ts">
const emit = defineEmits<{ drop: [value: FileList | null] }>()

const { t } = useI18n({ useScope: 'local', inheritLocale: true })

const dropzoneActive = shallowRef(false)
</script>

<template>
  <div
    @dragover.prevent="dropzoneActive = true"
    @dragleave.prevent="dropzoneActive = false"
    @drop.prevent="emit('drop', $event.dataTransfer?.files ?? null)"
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
