<script setup lang="ts">
import type { PublicAlbum } from '~/composables/useAlbums'

// Public, read-only Album view (issue #53): reachable by anyone with the
// link, no `auth`/`guest` middleware — a signed-in User browsing their own
// shared link should see the same thing an anonymous visitor does.
const route = useRoute()
const token = computed(() => route.params.token as string)

const { fetchPublicAlbum } = useAlbums()

const status = ref<'loading' | 'ready' | 'error'>('loading')
const album = ref<PublicAlbum | null>(null)

async function loadAlbum() {
  status.value = 'loading'
  try {
    album.value = await fetchPublicAlbum(token.value)
    status.value = 'ready'
  }
  catch {
    status.value = 'error'
  }
}

onMounted(loadAlbum)
</script>

<template>
  <div class="mx-auto flex max-w-5xl flex-col gap-y-8 py-10">
    <p v-if="status === 'loading'" class="text-center text-sm text-slate-500 dark:text-slate-300">
      Loading…
    </p>

    <div v-else-if="status === 'error'" class="flex flex-col items-center gap-y-4 py-20 text-center">
      <p>This share link is invalid or has been revoked.</p>
      <NuxtLink to="/login" class="text-sm underline">
        Go to sign in
      </NuxtLink>
    </div>

    <template v-else-if="album">
      <div class="flex flex-col gap-y-2 text-center">
        <h1 class="text-xl font-semibold">
          {{ album.title }}
        </h1>
        <p v-if="album.description" class="text-sm text-slate-500 dark:text-slate-300">
          {{ album.description }}
        </p>
        <p class="text-xs text-slate-500 dark:text-slate-300">
          Shared by {{ album.admin.first_name }} {{ album.admin.last_name }}
        </p>
      </div>

      <div v-if="!album.photos.length" class="py-20 text-center text-slate-500 dark:text-slate-300">
        <p>This album is empty.</p>
      </div>

      <div v-else class="grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-6">
        <div v-for="photo in album.photos" :key="photo.id" class="aspect-square overflow-hidden rounded">
          <img :src="photo.url" :alt="`Photo ${photo.id}`" class="h-full w-full object-cover" loading="lazy">
        </div>
      </div>
    </template>
  </div>
</template>
