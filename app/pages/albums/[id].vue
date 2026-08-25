<script setup lang="ts">
definePageMeta({ middleware: ['auth'] })

const route = useRoute()
const albumId = computed(() => Number(route.params.id))

const { user } = useCurrentUser()
const { fetchAlbum, updateAlbum, deleteAlbum, addPhotoToAlbum, removePhotoFromAlbum, addCollaborators, removeCollaborator, generateShareLink } = useAlbums()
const { photos: libraryPhotos, fetchNextPage: fetchNextLibraryPage, hasMore: libraryHasMore, loading: libraryLoading } = usePhotoLibrary()
const toast = useToast()
const { translateError } = useErrorMessage()
const { t } = useI18n()

const editingTitle = shallowRef(false)
const editingDescription = shallowRef(false)
const titleDraft = shallowRef('')
const descriptionDraft = shallowRef('')
const savingPhotoId = shallowRef<number | null>(null)
const deleting = shallowRef(false)
const inviteEmails = shallowRef('')
const inviting = shallowRef(false)
const removingCollaboratorId = shallowRef<number | null>(null)
const generatingShareLink = shallowRef(false)
const shareLinkCopied = shallowRef(false)
const isDeleteModalOpen = shallowRef(false)
const isAddPhotoPickerOpen = shallowRef(false)
const isCollaboratorsModalOpen = shallowRef(false)
const isShareModalOpen = shallowRef(false)

const { data: album, pending } = await useAsyncData(
  'album',
  async () => await fetchAlbum(albumId.value),
)

useHead({ title: computed(() => album.value?.title) })

const isAdmin = computed(() => !!album.value && !!user.value && album.value.admin.id === user.value.id)
const albumPhotoIds = computed(() => new Set(album.value?.photos.map(photo => photo.id) ?? []))
// Issue #53: built client-side from the Album's own id-based route + the
// admin-only share_token the full show response returns — no server-side
// origin/URL-building needed.
const shareUrl = computed(() => (album.value?.share_token && import.meta.client)
  ? `${window.location.origin}/albums/public/${album.value.share_token}`
  : null)

function startEditTitle() {
  titleDraft.value = album.value?.title ?? ''
  editingTitle.value = true
}

async function saveTitle() {
  if (!album.value)
    return
  editingTitle.value = false
  const trimmed = titleDraft.value.trim()
  if (!trimmed || trimmed === album.value.title)
    return

  try {
    const updated = await updateAlbum(album.value.id, { title: trimmed })
    album.value = { ...album.value, ...updated }
  }
  catch (error) {
    toast.add({ title: translateError(error), color: 'error' })
  }
}

function startEditDescription() {
  descriptionDraft.value = album.value?.description ?? ''
  editingDescription.value = true
}

async function saveDescription() {
  if (!album.value)
    return
  editingDescription.value = false
  const trimmed = descriptionDraft.value.trim()
  if (trimmed === (album.value.description ?? ''))
    return

  try {
    const updated = await updateAlbum(album.value.id, { description: trimmed })
    album.value = { ...album.value, ...updated }
  }
  catch (error) {
    toast.add({ title: translateError(error), color: 'error' })
  }
}

async function confirmDelete() {
  if (!album.value)
    return
  deleting.value = true
  try {
    await deleteAlbum(album.value.id)
    toast.add({ title: t('albumDeleted') })
    await navigateTo('/albums')
  }
  catch (error) {
    toast.add({ title: translateError(error), color: 'error' })
  }
  finally {
    deleting.value = false
    isDeleteModalOpen.value = false
  }
}

async function togglePhoto(photoId: number) {
  if (!album.value)
    return
  savingPhotoId.value = photoId
  try {
    album.value = albumPhotoIds.value.has(photoId)
      ? await removePhotoFromAlbum(album.value.id, photoId)
      : await addPhotoToAlbum(album.value.id, photoId)
  }
  catch (error) {
    toast.add({ title: translateError(error), color: 'error' })
  }
  finally {
    savingPhotoId.value = null
  }
}

async function openAddPhotoPicker() {
  if (!libraryPhotos.value.length)
    await fetchNextLibraryPage()
}

// Issue #52: the add-Collaborators endpoint distinguishes an email that
// was linked immediately (an existing User) from one that was invited
// instead (no account yet) — so the toast reports the actual outcome
// rather than a single "Invitation sent." for both cases.
function describeInviteResult({ linked, invited }: { linked: string[], invited: string[] }) {
  const parts: string[] = []
  if (linked.length)
    parts.push(t('collaboratorsAdded', linked.length))
  if (invited.length)
    parts.push(t('invitationsSent', invited.length))

  const message = parts.join(` ${t('and')} `)
  return `${message.charAt(0).toUpperCase()}${message.slice(1)}.`
}

async function submitInvite() {
  if (!album.value)
    return

  const emails = inviteEmails.value
    .split(/[\n,]/)
    .map(email => email.trim())
    .filter(email => email.length > 0)

  if (!emails.length)
    return

  inviting.value = true
  try {
    const result = await addCollaborators(album.value.id, emails)
    album.value = result
    inviteEmails.value = ''
    toast.add({ title: describeInviteResult(result) })
  }
  catch (error) {
    toast.add({ title: translateError(error), color: 'error' })
  }
  finally {
    inviting.value = false
  }
}

async function removeCollaboratorFromAlbum(userId: number) {
  if (!album.value)
    return
  removingCollaboratorId.value = userId
  try {
    album.value = await removeCollaborator(album.value.id, userId)
  }
  catch (error) {
    toast.add({ title: translateError(error), color: 'error' })
  }
  finally {
    removingCollaboratorId.value = null
  }
}

// Issue #53: opens the Share modal, generating a fresh Public Share Link
// token first if the Album doesn't have one yet — an admin who has never
// shared this Album shouldn't need a separate "create" step before
// seeing/copying a link.
async function openShareLinkModal() {
  if (album.value && !album.value.share_token)
    await regenerateShareLink()
}

async function regenerateShareLink() {
  if (!album.value)
    return
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
</script>

<template>
  <div class="mx-auto flex max-w-5xl flex-col gap-y-8">
    <p v-if="pending" class="text-center text-sm text-gray-500 dark:text-gray-300">
      {{ t('loading') }}
    </p>

    <template v-else-if="album">
      <div class="flex items-start justify-between gap-x-4">
        <div class="flex flex-1 flex-col gap-y-2">
          <input
            v-if="editingTitle"
            v-model="titleDraft"
            autofocus
            class="w-fit rounded border-none text-xl font-semibold focus-visible:outline-none focus-visible:ring focus-visible:ring-green-600 bg-white dark:bg-gray-800"
            @keyup.enter="saveTitle"
            @keyup.esc="editingTitle = false"
            @blur="saveTitle"
          >
          <button
            v-else
            type="button"
            class="w-fit text-left text-xl font-semibold"
            @click="startEditTitle"
          >
            {{ album.title }}
          </button>

          <textarea
            v-if="editingDescription"
            v-model="descriptionDraft"
            autofocus
            rows="2"
            class="w-full max-w-md rounded border-none text-sm focus-visible:outline-none focus-visible:ring focus-visible:ring-green-600 bg-white dark:bg-gray-800"
            @keyup.esc="editingDescription = false"
            @blur="saveDescription"
          />
          <button
            v-else
            type="button"
            class="w-fit text-left text-sm text-gray-500 dark:text-gray-300"
            @click="startEditDescription"
          >
            {{ album.description || t('addDescriptionPlaceholder') }}
          </button>
        </div>

        <div class="flex shrink-0 gap-x-2">
          <UModal
            v-model:open="isCollaboratorsModalOpen"
            :title="t('collaboratorsButton')"
          >
            <UTooltip :text="t('collaboratorsButton')">
              <UButton
                type="button"
                :aria-label="t('collaboratorsButton')"
                color="neutral"
                variant="soft"
                icon="ph:users"
              />
            </UTooltip>

            <template #body>
              <ul class="flex flex-col gap-y-2">
                <li class="flex items-center justify-between gap-x-2">
                  <span>{{ album?.admin.first_name }} {{ album?.admin.last_name }} <span class="text-xs text-gray-500 dark:text-gray-300">({{ t('admin') }})</span></span>
                </li>
                <li v-for="collaborator in album?.collaborators" :key="collaborator.id" class="flex items-center justify-between gap-x-2">
                  <span>{{ collaborator.first_name }} {{ collaborator.last_name }}</span>
                  <button
                    v-if="isAdmin"
                    type="button"
                    :title="t('removeCollaboratorTitle')"
                    :disabled="removingCollaboratorId === collaborator.id"
                    class="flex h-8 w-8 items-center justify-center rounded-full text-red-500 hover:bg-gray-200 disabled:opacity-50 dark:hover:bg-gray-700"
                    @click="removeCollaboratorFromAlbum(collaborator.id)"
                  >
                    <Icon name="ph:x-bold" />
                  </button>
                </li>
              </ul>

              <UForm
                v-if="isAdmin"
                class="space-y-2"
                :state="{ inviteEmails }"
                novalidate
                @submit.prevent="submitInvite"
              >
                <UFormField :label="t('inviteByEmailLabel')" name="inviteEmails">
                  <UInput
                    v-model="inviteEmails"
                    type="text"
                    autofocus
                    :placeholder="t('inviteByEmailPlaceholder')"
                    autocomplete="off"
                    class="w-full"
                  />
                </UFormField>
                <UButton
                  type="submit"
                  :disabled="!inviteEmails.trim()"
                  :loading="inviting"
                  block
                  :label="inviting ? t('inviting') : t('inviteButton')"
                />
              </UForm>
            </template>

            <template #footer="{ close }">
              <UButton
                type="button"
                :label="t('done')"
                color="neutral"
                variant="soft"
                @click="close"
              />
            </template>
          </UModal>

          <UModal
            v-if="isAdmin"
            v-model:open="isShareModalOpen"
            :title="album?.title ?? ''"
            :description="t('shareDescription')"
          >
            <UTooltip :text="t('shareButton')">
              <UButton
                type="button"
                :aria-label="t('shareButton')"
                color="neutral"
                variant="soft"
                icon="ph:share-network"
                @click="openShareLinkModal"
              />
            </UTooltip>

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

          <UModal
            v-model:open="isAddPhotoPickerOpen"
            :title="t('addPhotosModalTitle')"
          >
            <UTooltip :text="t('addPhotosButton')">
              <UButton
                type="button"
                :aria-label="t('addPhotosButton')"
                color="neutral"
                variant="soft"
                icon="ph:plus"
                @click="openAddPhotoPicker"
              />
            </UTooltip>

            <template #body>
              <p v-if="!libraryPhotos.length && !libraryLoading" class="text-gray-500 dark:text-gray-300">
                {{ t('libraryEmpty') }}
              </p>

              <div class="grid grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
                <button
                  v-for="photo in libraryPhotos"
                  :key="photo.id"
                  type="button"
                  :disabled="savingPhotoId === photo.id"
                  class="group relative aspect-square overflow-hidden rounded disabled:opacity-50"
                  @click="togglePhoto(photo.id)"
                >
                  <img :src="photo.url" :alt="t('photoAlt', { id: photo.id })" class="h-full w-full object-cover">
                  <div
                    v-if="albumPhotoIds.has(photo.id)"
                    class="absolute inset-0 flex items-center justify-center bg-green-500/50"
                  >
                    <Icon name="ph:check-bold" class="text-white" size="1.5em" />
                  </div>
                </button>
              </div>

              <button
                v-if="libraryHasMore"
                type="button"
                class="text-sm text-green-600 hover:underline dark:text-green-400"
                :disabled="libraryLoading"
                @click="fetchNextLibraryPage"
              >
                {{ libraryLoading ? t('loading') : t('loadMore') }}
              </button>
            </template>

            <template #footer="{ close }">
              <UButton
                type="button"
                :label="t('done')"
                color="neutral"
                variant="soft"
                @click="close"
              />
            </template>
          </UModal>

          <UModal
            v-if="isAdmin"
            v-model:open="isDeleteModalOpen"
            :title="t('deleteModalTitle')"
            :description="t('deleteModalBody')"
          >
            <UTooltip :text="t('deleteButton')">
              <UButton
                type="button"
                :aria-label="t('deleteButton')"
                color="error"
                variant="soft"
                icon="ph:trash"
              />
            </UTooltip>

            <template #footer="{ close }">
              <UButton
                type="button"
                :label="t('cancel')"
                color="neutral"
                variant="soft"
                @click="close"
              />
              <UButton
                type="button"
                :loading="deleting"
                :label="deleting ? t('deleting') : t('deleteButton')"
                color="error"
                @click="confirmDelete"
              />
            </template>
          </UModal>
        </div>
      </div>

      <div v-if="!album.photos.length" class="py-20 text-center text-gray-500 dark:text-gray-300">
        <p>{{ t('emptyAlbum') }}</p>
      </div>

      <div v-else class="grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-6">
        <div v-for="photo in album.photos" :key="photo.id" class="group relative aspect-square overflow-hidden rounded">
          <img :src="photo.url" :alt="t('photoAlt', { id: photo.id })" class="h-full w-full object-cover" loading="lazy">
          <button
            type="button"
            :title="t('removeFromAlbumTitle')"
            :disabled="savingPhotoId === photo.id"
            class="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/50 text-white opacity-0 transition-opacity group-hover:opacity-100 disabled:opacity-50"
            @click="togglePhoto(photo.id)"
          >
            <Icon name="ph:x-bold" />
          </button>
        </div>
      </div>
    </template>
  </div>
</template>

<i18n lang="json">
{
  "en": {
    "loading": "Loading…",
    "addDescriptionPlaceholder": "Add a description",
    "collaboratorsButton": "Collaborators",
    "shareButton": "Share",
    "addPhotosButton": "Add photos",
    "deleteButton": "Delete",
    "emptyAlbum": "This album is empty — add some photos to get started.",
    "photoAlt": "Photo {id}",
    "removeFromAlbumTitle": "Remove from album",
    "deleteModalTitle": "Delete this album",
    "deleteModalBody": "This action is irreversible. Photos in this album stay in your library. Are you sure?",
    "cancel": "Cancel",
    "deleting": "Deleting…",
    "addPhotosModalTitle": "Add photos to album",
    "libraryEmpty": "Your photo library is empty.",
    "loadMore": "Load more",
    "done": "Done",
    "admin": "admin",
    "removeCollaboratorTitle": "Remove collaborator",
    "inviteByEmailLabel": "Invite by email",
    "inviteByEmailPlaceholder": "jane{'@'}example.com, john{'@'}example.com",
    "inviting": "Inviting…",
    "inviteButton": "Invite",
    "shareHeading": "Sharing \"{title}\"",
    "shareDescription": "Anyone with this link can view this album's photos, without an account. They can't like, edit, or add photos.",
    "generatingLink": "Generating link…",
    "generateNewLink": "Generate new link",
    "copied": "Copied!",
    "copy": "Copy",
    "close": "Close",
    "albumDeleted": "Album deleted.",
    "collaboratorsAdded": "{count} collaborator added | {count} collaborators added",
    "invitationsSent": "{count} invitation sent | {count} invitations sent",
    "and": "and"
  }
}
</i18n>
