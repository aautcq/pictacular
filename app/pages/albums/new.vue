<script setup lang="ts">
definePageMeta({ middleware: ['auth'] })

const { createAlbum } = useAlbums()
const { addError } = useAlerts()
const { translateError } = useErrorMessage()
const { t } = useI18n()
const router = useRouter()

const title = ref('')
const description = ref('')
const loading = ref(false)

async function submit() {
  loading.value = true
  try {
    const album = await createAlbum({ title: title.value, description: description.value || undefined })
    await router.push(`/albums/${album.id}`)
  }
  catch (error) {
    addError(translateError(error))
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="mx-auto flex max-w-lg flex-col gap-y-6 py-10">
    <h1 class="text-xl font-semibold">
      {{ t('title') }}
    </h1>

    <form class="flex flex-col gap-y-4" @submit.prevent="submit">
      <AppFormField v-model="title" :label="t('titleLabel')" required autocomplete="off" />

      <label class="flex w-full flex-col gap-y-1">
        <span class="text-sm text-slate-600 dark:text-slate-300">{{ t('descriptionLabel') }}</span>
        <textarea
          v-model="description"
          rows="3"
          class="w-full rounded border-none bg-white px-3 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 dark:bg-slate-700"
        />
      </label>

      <button
        type="submit"
        :disabled="loading"
        class="mt-2 h-10 rounded bg-green-500 px-4 font-medium text-white hover:bg-green-600 disabled:opacity-50"
      >
        {{ loading ? t('creating') : t('submit') }}
      </button>
    </form>
  </div>
</template>

<i18n lang="json">
{
  "en": {
    "title": "New album",
    "titleLabel": "Title",
    "descriptionLabel": "Description",
    "creating": "Creating…",
    "submit": "Create album"
  }
}
</i18n>
