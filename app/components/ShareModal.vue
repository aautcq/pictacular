<script setup lang="ts">
import type { AlbumFull } from '~/composables/useAlbums'

const album = defineModel<AlbumFull>({ required: true })
const isOpen = defineModel<boolean>('isOpen', { required: true })

const { generateShareLink } = useAlbums()
const toast = useToast()
const { translateError } = useErrorMessage()
const { t } = useI18n({ useScope: 'local', inheritLocale: true })

const generatingShareLink = shallowRef(false)
const shareLinkCopied = shallowRef(false)

// Issue #53: built client-side from the Album's own id-based route + the
// admin-only share_token the full show response returns — no server-side
// origin/URL-building needed.
const shareUrl = computed(() => (album.value?.share_token && import.meta.client)
  ? `${window.location.origin}/albums/public/${album.value.share_token}`
  : null)

async function regenerateShareLink() {
  generatingShareLink.value = true
  shareLinkCopied.value = false
  try {
    const share_token = await generateShareLink(album.value.id)
    album.value = { ...album.value, share_token }
  }
  catch (error) {
    toast.add({ title: translateError(error), color: 'error' })
  }
  finally {
    generatingShareLink.value = false
  }
}

async function copyShareLink() {
  if (!shareUrl.value)
    return

  try {
    await navigator.clipboard.writeText(shareUrl.value)
  }
  catch (error) {
    toast.add({ title: translateError(error), color: 'error' })
    return
  }

  shareLinkCopied.value = true
  setTimeout(() => {
    shareLinkCopied.value = false
  }, 5000)
}

watch(() => isOpen.value, async (newValue) => {
  if (newValue && !album.value.share_token)
    await regenerateShareLink()
})
</script>

<template>
  <UModal
    v-model:open="isOpen"
    :title="album?.title ?? ''"
    :description="t('shareDescription')"
  >
    <template #body>
      <p v-if="generatingShareLink" class="text-sm text-gray-500 dark:text-gray-300">
        {{ t('generatingLink') }}
      </p>
      <div v-else-if="shareUrl" class="wrap-break-words font-light rounded bg-white px-3 py-2 text-sm dark:bg-gray-700">
        {{ shareUrl }}
      </div>
    </template>

    <template #footer>
      <UButton
        type="button"
        :label="t('generateNewLink')"
        color="neutral"
        variant="soft"
        @click="regenerateShareLink"
      />
      <UButton
        type="button"
        :disabled="!shareUrl || shareLinkCopied"
        :icon="shareLinkCopied ? 'ph:check-bold' : 'ph:copy'"
        :label="shareLinkCopied ? t('copied') : t('copy')"
        color="neutral"
        variant="soft"
        @click="copyShareLink"
      />
    </template>
  </UModal>
</template>

<i18n lang="json">
{
  "en": {
    "shareDescription": "Anyone with this link can view this album's photos, without an account. They can't like, edit, or add photos.",
    "generatingLink": "Generating link…",
    "generateNewLink": "Generate new link",
    "copied": "Copied!",
    "copy": "Copy",
    "close": "Close"
  }
}
</i18n>
