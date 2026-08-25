<script setup lang="ts">
import type { NuxtError } from '#app'

// Nuxt's global fatal-error fallback: rendered for unmatched routes (404)
// and uncaught SSR/render exceptions. It must not assume app.vue's
// `callOnce('fetch-current-user', …)` auth bootstrap has run, since a fatal
// error can occur before or during that flow — so this page stays fully
// self-contained and doesn't reuse AppHeader/AppAlerts or any auth state.
const props = defineProps<{ error: NuxtError }>()

const { t } = useI18n({ useScope: 'local', inheritLocale: true })

const isNotFound = computed(() => props.error.statusCode === 404)
const title = computed(() => (isNotFound.value ? 'Page not found' : 'Something went wrong'))
const message = computed(() => (
  isNotFound.value
    ? 'The page you’re looking for doesn’t exist.'
    : 'An unexpected error occurred. Please try again later.'
))

function goHome() {
  clearError({ redirect: '/' })
}
</script>

<template>
  <UApp>
    <div class="flex min-h-screen flex-col items-center justify-center gap-y-6 px-6 text-center font-main">
      <p class="font-semibold text-gray-900 dark:text-gray-100">
        Pictacular
      </p>

      <div class="flex max-w-sm flex-col gap-y-2">
        <h1 class="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {{ title }}
        </h1>
        <p class="text-sm text-gray-600 dark:text-gray-400">
          {{ message }}
        </p>
      </div>

      <UButton
        type="button"
        :label="t('goHome')"
        @click="goHome"
      />
    </div>
  </UApp>
</template>

<i18n lang="json">
{
  "en": {
    "goHome": "Go home"
  }
}
</i18n>
