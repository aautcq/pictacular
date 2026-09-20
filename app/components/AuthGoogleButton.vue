<script setup lang="ts">
const { t } = useI18n({ useScope: 'local', inheritLocale: true })
</script>

<template>
  <UButton
    to="/api/auth/google"
    external
    block
    color="neutral"
    variant="outline"
    icon="ph:google-logo"
    :label="t('continueWithGoogle')"
  />
</template>

<i18n lang="json">
{
  "en": {
    "continueWithGoogle": "Continue with Google"
  }
}
</i18n>
