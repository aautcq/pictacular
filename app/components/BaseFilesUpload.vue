<script setup lang="ts">
const emit = defineEmits<{
  filesUploaded: [files: FileList]
}>()

const { t } = useI18n({ useScope: 'local', inheritLocale: true })

const fileInput = useTemplateRef<HTMLInputElement | null>('fileInput')

function handleFiles(fileList: FileList | null) {
  if (!fileList)
    return
  emit('filesUploaded', fileList)
}

function onFileInputChange(event: Event) {
  handleFiles((event.target as HTMLInputElement).files)
  if (fileInput.value)
    fileInput.value.value = ''
}
</script>

<template>
  <UTooltip :text="t('uploadPhotos')">
    <UButton
      type="button"
      variant="outline"
      icon="ph:upload-simple"
      :aria-label="t('uploadPhotos')"
      @click="fileInput?.click()"
    />
  </UTooltip>
  <input
    ref="fileInput"
    type="file"
    accept="image/*"
    multiple
    class="hidden"
    aria-hidden="true"
    @change="onFileInputChange"
  >
</template>

<i18n lang="json">
{
  "en": {
    "uploadPhotos": "Upload photos"
  }
}
</i18n>
