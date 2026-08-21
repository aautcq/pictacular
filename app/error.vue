<script setup lang="ts">
import type { NuxtError } from '#app'

// Nuxt's global fatal-error fallback: rendered for unmatched routes (404)
// and uncaught SSR/render exceptions. It must not assume app.vue's
// `callOnce('fetch-current-user', …)` auth bootstrap has run, since a fatal
// error can occur before or during that flow — so this page stays fully
// self-contained and doesn't reuse AppHeader/AppAlerts or any auth state.
const props = defineProps<{ error: NuxtError }>()

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
  <div class="flex min-h-screen flex-col items-center justify-center gap-y-6 px-6 text-center font-main">
    <p class="font-semibold text-slate-900 dark:text-slate-100">
      Pictacular
    </p>

    <div class="flex max-w-sm flex-col gap-y-2">
      <h1 class="text-lg font-semibold text-slate-900 dark:text-slate-100">
        {{ title }}
      </h1>
      <p class="text-sm text-slate-600 dark:text-slate-400">
        {{ message }}
      </p>
    </div>

    <button
      type="button"
      class="h-10 rounded bg-green-500 px-4 font-medium text-white hover:bg-green-600"
      @click="goHome"
    >
      Go home
    </button>
  </div>
</template>
