<script setup lang="ts">
definePageMeta({ middleware: ['auth'] })

const { createAlbum } = useAlbums()
const toast = useToast()
const { translateError } = useErrorMessage()
const { t } = useI18n({ useScope: 'local', inheritLocale: true })
useHead({ title: computed(() => t('title')) })

const state = reactive({
  title: '',
  description: '',
})

const loading = shallowRef(false)

async function submit() {
  loading.value = true
  try {
    const album = await createAlbum({
      title: state.title,
      description: state.description || undefined,
    })
    await navigateTo(`/albums/${album.id}`)
  }
  catch (error) {
    toast.add({ title: translateError(error), color: 'error' })
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="mx-auto flex max-w-lg flex-col gap-y-6">
    <h1 class="text-xl font-semibold">
      {{ t('title') }}
    </h1>

    <UForm
      class="space-y-4"
      :state="state"
      novalidate
      @submit.prevent="submit"
    >
      <UFormField :label="t('titleLabel')" name="title">
        <UInput
          v-model="state.title"
          required
          autofocus
          autocomplete="off"
          :placeholder="t('titlePlaceholder')"
          class="w-full"
        />
      </UFormField>

      <UFormField :label="t('descriptionLabel')" name="description">
        <UTextarea
          v-model="state.description"
          :rows="3"
          autocomplete="off"
          :placeholder="t('descriptionPlaceholder')"
          class="w-full"
        />
      </UFormField>

      <UButton
        type="submit"
        :loading="loading"
        :label="loading ? t('creating') : t('submit')"
      />
    </UForm>
  </div>
</template>

<i18n lang="json">
{
  "en": {
    "title": "New album",
    "titleLabel": "Title",
    "titlePlaceholder": "My album",
    "descriptionLabel": "Description",
    "descriptionPlaceholder": "My album description",
    "creating": "Creating…",
    "submit": "Create album"
  }
}
</i18n>
