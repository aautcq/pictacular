<script setup lang="ts">
const { selectedCount } = defineProps<{
  selectedCount: number
}>()

const emit = defineEmits<{
  cancelSelection: []
}>()

const { t } = useI18n({ useScope: 'local', inheritLocale: true })
</script>

<template>
  <UBadge
    color="success"
    variant="subtle"
    :label="t('selectedCount', selectedCount)"
  >
    <template #trailing>
      <UTooltip :text="t('cancel')">
        <UButton
          type="button"
          :aria-label="t('cancel')"
          color="neutral"
          variant="soft"
          square
          icon="ph:x"
          size="xs"
          @click="emit('cancelSelection')"
        />
      </UTooltip>
    </template>
  </UBadge>
</template>

<i18n lang="json">
{
  "en": {
    "selectedCount": "{count} selected | {count} selected",
    "cancel": "Cancel selection"
  }
}
</i18n>
