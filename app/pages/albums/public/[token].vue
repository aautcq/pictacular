<script setup lang="ts">
// Public, read-only Album view (issue #53): reachable by anyone with the
// link, no `auth`/`guest` middleware — a signed-in User browsing their own
// shared link should see the same thing an anonymous visitor does.
const route = useRoute()
const token = computed(() => route.params.token as string)

const { fetchPublicAlbum } = useAlbums()
const { t } = useI18n({ useScope: 'local', inheritLocale: true })

const { data: album, status } = await useAsyncData(
  `album-public-${token.value}`,
  async () => await fetchPublicAlbum(token.value),
)

useHead({ title: computed(() => album.value?.title) })
</script>

<template>
  <div class="mx-auto flex max-w-5xl flex-col gap-y-8">
    <p v-if="status === 'pending'" class="text-center text-sm text-gray-500 dark:text-gray-300">
      {{ t('loading') }}
    </p>

    <div v-else-if="status === 'error'" class="flex flex-col items-center gap-y-4 py-20 text-center">
      <p>{{ t('invalidLink') }}</p>
      <NuxtLink to="/login" class="text-sm underline">
        {{ t('goToSignIn') }}
      </NuxtLink>
    </div>

    <template v-else-if="album">
      <div class="flex flex-col gap-y-2 text-center">
        <h1 class="text-xl font-semibold">
          {{ album.title }}
        </h1>
        <p v-if="album.description" class="text-sm text-gray-500 dark:text-gray-300">
          {{ album.description }}
        </p>
        <p class="text-xs text-gray-500 dark:text-gray-300">
          {{ t('sharedBy', { name: `${album.admin.first_name} ${album.admin.last_name}` }) }}
        </p>
      </div>

      <div v-if="!album.photos.length" class="py-20 text-center text-gray-500 dark:text-gray-300">
        <p>{{ t('emptyAlbum') }}</p>
      </div>

      <div v-else class="grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-6">
        <div
          v-for="photo in album.photos"
          :key="photo.id"
          class="aspect-square overflow-hidden rounded"
        >
          <img
            :src="photo.url"
            :alt="t('photoAlt', { id: photo.id })"
            class="h-full w-full object-cover"
            loading="lazy"
          >
        </div>
      </div>
    </template>
  </div>
</template>

<i18n lang="json">
{
  "en": {
    "loading": "Loading…",
    "invalidLink": "This share link is invalid or has been revoked.",
    "goToSignIn": "Go to sign in",
    "sharedBy": "Shared by {name}",
    "emptyAlbum": "This album is empty.",
    "photoAlt": "Photo {id}"
  }
}
</i18n>
