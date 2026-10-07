<script setup lang="ts">
const { searchAlbums } = useAlbums()
const { t } = useI18n({ useScope: 'local', inheritLocale: true })

const { query } = useSearch('albums', searchAlbums)
</script>

<template>
  <div>
    <BaseSearchToggle
      v-model="query"
      :label="t('searchLabel')"
      :placeholder="t('searchPlaceholder')"
    />
  </div>
</template>

<i18n lang="json">
{
  "en": {
    "searchLabel": "Search albums",
    "searchPlaceholder": "Search albums…"
  }
}
</i18n>
