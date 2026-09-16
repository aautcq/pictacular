<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import type { GridColumnBreakpoint } from '~/composables/useVirtualGrid'

definePageMeta({ layout: false, middleware: ['auth'] })

const breakpoints: GridColumnBreakpoint[] = [
  { minWidth: 0, columns: 2 },
  { minWidth: 640, columns: 4 },
  { minWidth: 768, columns: 6 },
]

const route = useRoute()
const albumId = computed(() => Number(route.params.id))

const { user } = useCurrentUser()
const { fetchAlbum, updateAlbum, removePhotoFromAlbum } = useAlbums()
const { toggleLike } = usePhotoLibrary()
const { queueUpload, uploads } = usePhotoUpload()
const toast = useToast()
const { translateError } = useErrorMessage()
const { t } = useI18n({ useScope: 'local', inheritLocale: true })
const { t: tg } = useI18n({ useScope: 'global' })

const editingTitle = shallowRef(false)
const editingDescription = shallowRef(false)
const titleDraft = shallowRef('')
const descriptionDraft = shallowRef('')
const deleting = shallowRef(false)
const isDeleteModalOpen = shallowRef(false)
const isRemovePhotosModalOpen = shallowRef(false)
const isAddPhotoPickerOpen = shallowRef(false)
const isCollaboratorsModalOpen = shallowRef(false)
const isShareModalOpen = shallowRef(false)

const {
  photos,
  hasMore: photosHaveMore,
  loading: photosLoading,
  fetchNextPage: fetchNextPhotosPage,
  prependPhoto,
  removePhoto,
  updatePhoto,
} = useAlbumPhotos(albumId)

// Issue #170: an Album can hold thousands of Photos, so its metadata and
// its first page of Photos are two separate requests — run together
// rather than one after the other, so `pending` going false always means
// both the metadata and at least the first Photo page are ready.
const [{ data: album, pending }] = await Promise.all([
  useAsyncData('album', async () => await fetchAlbum(albumId.value), { watch: [albumId] }),
  useAsyncData('album-photos', fetchNextPhotosPage),
])

const {
  selectedIds,
  selectedCount,
  selectionMode,
  detailsPhotoId,
  detailsPhoto,
  hasPrevious,
  hasNext,
  toggleSelection,
  clearSelection,
  showPrevious,
  showNext,
  closeDetails,
  downloadSelected,
} = usePhotoGallery(photos)

useHead({ title: computed(() => album.value?.title) })

const isAdmin = computed(() => !!album.value && !!user.value && album.value.admin.id === user.value.id)

function startEditTitle() {
  if (!isAdmin.value)
    return
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
  if (!isAdmin.value)
    return
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

async function onToggleLike(photo: Photo) {
  try {
    const updated = await toggleLike(photo)
    updatePhoto(updated)
  }
  catch (error) {
    toast.add({ title: translateError(error), color: 'error' })
  }
}

async function confirmRemoveSelected() {
  deleting.value = true
  try {
    await Promise.all([...selectedIds.value].map(async (id) => {
      await removePhotoFromAlbum(albumId.value, id)
      removePhoto(id)
    }))
    toast.add({ title: t('photosDeleted') })
    clearSelection()
    isRemovePhotosModalOpen.value = false
  }
  catch (error) {
    toast.add({ title: translateError(error), color: 'error' })
  }
  finally {
    deleting.value = false
  }
}

async function handleFiles(fileList: FileList | null) {
  if (!fileList || !album.value)
    return
  for (const file of Array.from(fileList)) {
    if (file.type.startsWith('image/')) {
      const photo = await queueUpload(file)
      if (photo)
        prependPhoto(photo)
    }
  }
}

const settingsItems = computed<DropdownMenuItem[][]>(() => [
  [
    {
      label: t('addPhotosButton'),
      icon: 'ph:plus',
      onSelect: () => { isAddPhotoPickerOpen.value = true },
      visible: isAdmin.value,
    },
  ],
  [
    {
      label: t('shareButton'),
      icon: 'ph:share-network',
      onSelect: async () => { isShareModalOpen.value = true },
      visible: true,
    },
    {
      label: t('collaboratorsButton'),
      icon: 'ph:users',
      onSelect: () => { isCollaboratorsModalOpen.value = true },
      visible: isAdmin.value,
    },
  ],
  [
    {
      label: t('download'),
      icon: 'ph:download-simple',
      onSelect: () => { downloadSelected() },
      visible: selectionMode.value,
    },
    {
      label: t('remove'),
      icon: 'ph:trash-simple',
      color: 'warning',
      onSelect: () => { isRemovePhotosModalOpen.value = true },
      visible: selectionMode.value && isAdmin.value,
    },
  ],
  [
    {
      label: t('deleteModalTitle'),
      icon: 'ph:trash',
      color: 'error',
      onSelect: () => { isDeleteModalOpen.value = true },
      visible: isAdmin.value,
    },
  ],
].map(group => group?.filter(item => item.visible)).filter(group => group?.length > 0) as DropdownMenuItem[][])
</script>

<template>
  <div>
    <NuxtLayout name="default">
      <template #header-actions>
        <HeaderSelectedMenu
          v-if="selectionMode"
          :selected-count="selectedCount"
          @cancel-selection="clearSelection"
        />

        <UDropdownMenu :items="settingsItems">
          <UTooltip :text="t('settings')">
            <UButton
              icon="ph:dots-three-vertical"
              color="neutral"
              variant="soft"
              :aria-label="t('settings')"
            />
          </UTooltip>
        </UDropdownMenu>

        <BaseFilesUpload v-if="isAdmin" @files-uploaded="handleFiles" />
      </template>

      <BaseDropzone @drop="($event) => isAdmin && handleFiles($event)">
        <p v-if="pending" class="text-center text-sm text-gray-500 dark:text-gray-300">
          {{ t('loading') }}
        </p>

        <div v-else-if="album" class="flex flex-1 flex-col justify-baseline gap-y-2 mb-5">
          <div class="flex gap-x-1 items-baseline">
            <NuxtLink
              to="/albums"
              class="text-xl font-semibold"
            >
              {{ tg('common.nav.albums') }}
            </NuxtLink>

            <Icon name="ph:greater-than" />

            <UInput
              v-if="editingTitle"
              v-model="titleDraft"
              autofocus
              name="title"
              type="text"
              size="xl"
              variant="none"
              :ui="{ base: 'text-xl font-semibold text-inherit p-0' }"
              @keyup.enter="saveTitle"
              @keyup.esc="editingTitle = false"
              @blur="saveTitle"
            />

            <button
              v-else
              type="button"
              class="w-fit text-left text-xl font-semibold"
              @click="startEditTitle"
            >
              {{ album.title }}
            </button>

            <UAvatarGroup size="sm" :max="5" class="ml-auto">
              <UTooltip
                v-for="collaborator in album?.collaborators"
                :key="collaborator.id"
                :text="`${collaborator.first_name} ${collaborator.last_name}`"
              >
                <UAvatar
                  :src="collaborator.avatar_url ?? undefined"
                  :alt="`${collaborator.first_name} ${collaborator.last_name}`"
                />
              </UTooltip>
            </UAvatarGroup>
          </div>

          <textarea
            v-if="editingDescription"
            v-model="descriptionDraft"
            autofocus
            rows="2"
            name="description"
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

        <PhotoUploads v-if="uploads.length" :uploads />

        <div v-if="album && !photos.length && !photosLoading" class="py-20 text-center text-gray-500 dark:text-gray-300">
          <p>{{ t('emptyAlbum') }}</p>
        </div>

        <BaseVirtualGrid
          v-if="album"
          :items="photos"
          :item-key="(photo: Photo) => photo.id"
          :has-more="photosHaveMore"
          :loading="photosLoading"
          :breakpoints="breakpoints"
          @load-more="fetchNextPhotosPage"
        >
          <template #default="{ item: photo }">
            <BaseGalleryPhoto
              :photo="photo"
              :is-selected="selectedIds.has(photo.id)"
              :selection-mode="selectionMode"
              @toggle-selection="toggleSelection"
              @toggle-like="onToggleLike"
              @click="detailsPhotoId = photo.id"
            />
          </template>

          <template #loading>
            <p class="text-center text-sm text-gray-500 dark:text-gray-300">
              {{ t('loading') }}
            </p>
          </template>
        </BaseVirtualGrid>
      </BaseDropzone>

      <Transition name="modal-fade">
        <PhotoDetails
          v-if="detailsPhoto"
          :photo="detailsPhoto"
          :has-previous="hasPrevious"
          :has-next="hasNext"
          @show-previous="showPrevious"
          @show-next="showNext"
          @toggle-like="onToggleLike"
          @close="closeDetails"
        />
      </Transition>

      <CollaboratorsModal
        v-if="album"
        v-model:is-open="isCollaboratorsModalOpen"
        v-model="album"
      />

      <ShareModal
        v-if="isAdmin && album"
        v-model:is-open="isShareModalOpen"
        v-model="album"
      />

      <AddPhotoPickerModal
        v-if="album"
        v-model:is-open="isAddPhotoPickerOpen"
        :album-id="album.id"
        @photo-added="prependPhoto"
        @photo-removed="removePhoto"
      />

      <DeleteAlbumModal
        v-if="isAdmin && album"
        v-model:is-open="isDeleteModalOpen"
        :album
      />

      <UModal
        v-if="isAdmin"
        v-model:open="isRemovePhotosModalOpen"
        :title="t('removeModalTitle', selectedCount)"
        :description="t('removeModalBody')"
      >
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
            :label="deleting ? t('removing') : t('remove')"
            color="error"
            @click="confirmRemoveSelected"
          />
        </template>
      </UModal>
    </NuxtLayout>
  </div>
</template>

<i18n lang="json">
{
  "en": {
    "loading": "Loading…",
    "addDescriptionPlaceholder": "Add a description",
    "collaboratorsButton": "Collaborators",
    "shareButton": "Share",
    "settings": "Settings",
    "addPhotosButton": "Add photos from gallery",
    "deleteButton": "Delete",
    "emptyAlbum": "This album is empty — add some photos to get started.",
    "photoAlt": "Photo {id}",
    "removeFromAlbumTitle": "Remove from album",
    "cancel": "Cancel",
    "close": "Close",
    "removeModalTitle": "Remove {count} photo | Remove {count} photos",
    "removeModalBody": "This action is irreversible. Are you sure?",
    "removing": "Removing…",
    "remove": "Remove photos",
    "download": "Download",
    "deleteModalTitle": "Delete this album"
  }
}
</i18n>
