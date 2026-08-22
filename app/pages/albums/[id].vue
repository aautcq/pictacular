<script setup lang="ts">
import type { AlbumFull } from '~/composables/useAlbums'

definePageMeta({ middleware: ['auth'] })

const route = useRoute()
const router = useRouter()
const albumId = computed(() => Number(route.params.id))

const { user } = useCurrentUser()
const { fetchAlbum, updateAlbum, deleteAlbum, addPhotoToAlbum, removePhotoFromAlbum, addCollaborators, removeCollaborator, generateShareLink } = useAlbums()
const { photos: libraryPhotos, fetchNextPage: fetchNextLibraryPage, hasMore: libraryHasMore, loading: libraryLoading } = usePhotoLibrary()
const { addError, addSuccess } = useAlerts()
const { translateError } = useErrorMessage()
const { t } = useI18n()
const { close: closePicker, open: openPicker } = useModal('add-photo-to-album')
const { close: closeDeleteModal, open: openDeleteModal } = useModal('delete-album')
const { close: closeCollaboratorsModal, open: openCollaboratorsModal } = useModal('album-collaborators')
const { close: closeShareLinkModal, open: openShareModal } = useModal('album-share-link')

const album = ref<AlbumFull | null>(null)
const loading = ref(true)
const editingTitle = ref(false)
const editingDescription = ref(false)
const titleDraft = ref('')
const descriptionDraft = ref('')
const savingPhotoId = ref<number | null>(null)
const deleting = ref(false)
const inviteEmails = ref('')
const inviting = ref(false)
const removingCollaboratorId = ref<number | null>(null)
const generatingShareLink = ref(false)
const shareLinkCopied = ref(false)

const isAdmin = computed(() => !!album.value && !!user.value && album.value.admin.id === user.value.id)
const albumPhotoIds = computed(() => new Set(album.value?.photos.map(photo => photo.id) ?? []))
// Issue #53: built client-side from the Album's own id-based route + the
// admin-only share_token the full show response returns — no server-side
// origin/URL-building needed.
const shareUrl = computed(() => (album.value?.share_token && import.meta.client)
  ? `${window.location.origin}/albums/public/${album.value.share_token}`
  : null)

async function loadAlbum() {
  loading.value = true
  try {
    album.value = await fetchAlbum(albumId.value)
  }
  catch (error) {
    addError(translateError(error))
    await router.push('/albums')
  }
  finally {
    loading.value = false
  }
}

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
    addError(translateError(error))
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
    addError(translateError(error))
  }
}

async function confirmDelete() {
  if (!album.value)
    return
  deleting.value = true
  try {
    await deleteAlbum(album.value.id)
    addSuccess(t('albumDeleted'))
    await router.push('/albums')
  }
  catch (error) {
    addError(translateError(error))
  }
  finally {
    deleting.value = false
    closeDeleteModal()
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
    addError(translateError(error))
  }
  finally {
    savingPhotoId.value = null
  }
}

async function openAddPhotoPicker() {
  openPicker()
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
    addSuccess(describeInviteResult(result))
  }
  catch (error) {
    addError(translateError(error))
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
    addError(translateError(error))
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
  openShareModal()
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
    addError(translateError(error))
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
    addError(translateError(error))
    return
  }

  shareLinkCopied.value = true
  setTimeout(() => {
    shareLinkCopied.value = false
  }, 5000)
}

onMounted(loadAlbum)
</script>

<template>
  <div class="mx-auto flex max-w-5xl flex-col gap-y-8 py-10">
    <p v-if="loading" class="text-center text-sm text-slate-500 dark:text-slate-300">
      {{ t('loading') }}
    </p>

    <template v-else-if="album">
      <div class="flex items-start justify-between gap-x-4">
        <div class="flex flex-1 flex-col gap-y-2">
          <input
            v-if="editingTitle"
            v-model="titleDraft"
            autofocus
            class="h-10 w-full max-w-md rounded border-none bg-white px-3 text-xl font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 dark:bg-slate-700"
            @keyup.enter="saveTitle"
            @keyup.esc="editingTitle = false"
            @blur="saveTitle"
          >
          <button v-else type="button" class="w-fit text-left text-xl font-semibold hover:underline" @click="startEditTitle">
            {{ album.title }}
          </button>

          <textarea
            v-if="editingDescription"
            v-model="descriptionDraft"
            autofocus
            rows="2"
            class="w-full max-w-md rounded border-none bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 dark:bg-slate-700"
            @keyup.esc="editingDescription = false"
            @blur="saveDescription"
          />
          <button
            v-else
            type="button"
            class="w-fit text-left text-sm text-slate-500 hover:underline dark:text-slate-300"
            @click="startEditDescription"
          >
            {{ album.description || t('addDescriptionPlaceholder') }}
          </button>
        </div>

        <div class="flex shrink-0 gap-x-2">
          <button
            type="button"
            class="flex h-10 items-center gap-x-2 rounded bg-slate-200 px-4 font-medium hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600"
            @click="openCollaboratorsModal"
          >
            <Icon name="ph:users" size="1.1em" />
            {{ t('collaboratorsButton') }}
          </button>
          <button
            v-if="isAdmin"
            type="button"
            class="flex h-10 items-center gap-x-2 rounded bg-slate-200 px-4 font-medium hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600"
            @click="openShareLinkModal"
          >
            <Icon name="ph:share-network" size="1.1em" />
            {{ t('shareButton') }}
          </button>
          <button
            type="button"
            class="flex h-10 items-center gap-x-2 rounded bg-green-500 px-4 font-medium text-white hover:bg-green-600"
            @click="openAddPhotoPicker"
          >
            <Icon name="ph:plus" size="1.1em" />
            {{ t('addPhotosButton') }}
          </button>
          <button
            v-if="isAdmin"
            type="button"
            class="flex h-10 items-center gap-x-2 rounded bg-slate-200 px-4 font-medium text-red-500 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600"
            @click="openDeleteModal"
          >
            <Icon name="ph:trash" size="1.1em" />
            {{ t('deleteButton') }}
          </button>
        </div>
      </div>

      <div v-if="!album.photos.length" class="py-20 text-center text-slate-500 dark:text-slate-300">
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

    <AppModal name="delete-album">
      <div class="flex flex-col gap-y-6">
        <h2 class="text-lg font-semibold">
          {{ t('deleteModalTitle') }}
        </h2>
        <p>{{ t('deleteModalBody') }}</p>
        <div class="flex justify-end gap-3">
          <button type="button" class="h-10 rounded bg-slate-200 px-4 font-medium hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600" @click="closeDeleteModal">
            {{ t('cancel') }}
          </button>
          <button type="button" :disabled="deleting" class="h-10 rounded bg-red-500 px-4 font-medium text-white hover:bg-red-600 disabled:opacity-50" @click="confirmDelete">
            {{ deleting ? t('deleting') : t('deleteButton') }}
          </button>
        </div>
      </div>
    </AppModal>

    <AppModal name="add-photo-to-album">
      <div class="flex max-h-[80vh] flex-col gap-y-4">
        <h2 class="text-lg font-semibold">
          {{ t('addPhotosModalTitle') }}
        </h2>

        <div v-if="!libraryPhotos.length && !libraryLoading" class="py-10 text-center text-slate-500 dark:text-slate-300">
          <p>{{ t('libraryEmpty') }}</p>
        </div>

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

        <button
          type="button"
          class="mt-2 h-10 rounded bg-slate-200 px-4 font-medium hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600"
          @click="closePicker"
        >
          {{ t('done') }}
        </button>
      </div>
    </AppModal>

    <AppModal name="album-collaborators">
      <div class="flex flex-col gap-y-4">
        <h2 class="text-lg font-semibold">
          {{ t('collaboratorsButton') }}
        </h2>

        <ul class="flex flex-col gap-y-2">
          <li class="flex items-center justify-between gap-x-2">
            <span>{{ album?.admin.first_name }} {{ album?.admin.last_name }} <span class="text-xs text-slate-500 dark:text-slate-300">({{ t('admin') }})</span></span>
          </li>
          <li v-for="collaborator in album?.collaborators" :key="collaborator.id" class="flex items-center justify-between gap-x-2">
            <span>{{ collaborator.first_name }} {{ collaborator.last_name }}</span>
            <button
              v-if="isAdmin"
              type="button"
              :title="t('removeCollaboratorTitle')"
              :disabled="removingCollaboratorId === collaborator.id"
              class="flex h-8 w-8 items-center justify-center rounded-full text-red-500 hover:bg-slate-200 disabled:opacity-50 dark:hover:bg-slate-700"
              @click="removeCollaboratorFromAlbum(collaborator.id)"
            >
              <Icon name="ph:x-bold" />
            </button>
          </li>
        </ul>

        <form v-if="isAdmin" class="flex flex-col gap-y-2" @submit.prevent="submitInvite">
          <label class="flex w-full flex-col gap-y-1">
            <span class="text-sm text-slate-600 dark:text-slate-300">{{ t('inviteByEmailLabel') }}</span>
            <input
              v-model="inviteEmails"
              type="text"
              :placeholder="t('inviteByEmailPlaceholder')"
              class="h-10 w-full rounded border-none bg-white px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 dark:bg-slate-700"
            >
          </label>
          <button
            type="submit"
            :disabled="inviting || !inviteEmails.trim()"
            class="h-10 rounded bg-green-500 px-4 font-medium text-white hover:bg-green-600 disabled:opacity-50"
          >
            {{ inviting ? t('inviting') : t('inviteButton') }}
          </button>
        </form>

        <button
          type="button"
          class="mt-2 h-10 rounded bg-slate-200 px-4 font-medium hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600"
          @click="closeCollaboratorsModal"
        >
          {{ t('done') }}
        </button>
      </div>
    </AppModal>

    <AppModal name="album-share-link">
      <div class="flex flex-col gap-y-4">
        <i18n-t keypath="shareHeading" tag="h2" class="text-lg font-semibold">
          <template #title>
            {{ album?.title }}
          </template>
        </i18n-t>

        <p class="text-sm text-slate-600 dark:text-slate-300">
          {{ t('shareDescription') }}
        </p>

        <p v-if="generatingShareLink" class="text-sm text-slate-500 dark:text-slate-300">
          {{ t('generatingLink') }}
        </p>
        <div v-else-if="shareUrl" class="break-words rounded bg-white px-3 py-2 text-sm dark:bg-slate-700">
          {{ shareUrl }}
        </div>

        <div class="flex justify-end gap-x-2">
          <button
            type="button"
            class="h-10 rounded bg-slate-200 px-4 font-medium hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600"
            @click="regenerateShareLink"
          >
            {{ t('generateNewLink') }}
          </button>
          <button
            type="button"
            :disabled="!shareUrl || shareLinkCopied"
            class="flex h-10 items-center gap-x-2 rounded bg-green-500 px-4 font-medium text-white hover:bg-green-600 disabled:opacity-50"
            @click="copyShareLink"
          >
            <Icon :name="shareLinkCopied ? 'ph:check-bold' : 'ph:copy'" size="1.1em" />
            {{ shareLinkCopied ? t('copied') : t('copy') }}
          </button>
        </div>

        <button
          type="button"
          class="mt-2 h-10 rounded bg-slate-200 px-4 font-medium hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600"
          @click="closeShareLinkModal"
        >
          {{ t('close') }}
        </button>
      </div>
    </AppModal>
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
