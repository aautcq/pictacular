import type { Photo } from './usePhotoLibrary'

// An Album's own paginated Photo list (issue #170): mirrors
// usePhotoLibrary.ts's keyset-cursor shape (photos/nextCursor/loaded/
// loading/hasMore/fetchNextPage) and, like it, is backed by `useState`
// under a fixed key — not because it's meant to be shared across
// different Albums (it explicitly isn't, see the `watch` below), but so
// the SSR-rendered first page survives client hydration instead of being
// silently discarded when this composable's plain local `ref`s would
// otherwise be re-created empty on the client. `albumId` is reactive so
// navigating from one Album straight to another (Vue Router reuses the
// `[id].vue` instance rather than remounting it) resets and refetches
// instead of leaving the previous Album's Photos on screen.
export function useAlbumPhotos(albumId: Ref<number>) {
  const photos = useState<Photo[]>('album-photos', () => [])
  const nextCursor = useState<number | null>('album-photos-cursor', () => null)
  const loaded = useState<boolean>('album-photos-loaded', () => false)
  const loading = useState<boolean>('album-photos-loading', () => false)

  const hasMore = computed(() => !loaded.value || nextCursor.value !== null)

  function reset() {
    photos.value = []
    nextCursor.value = null
    loaded.value = false
  }

  async function fetchNextPage() {
    if (loading.value || (loaded.value && nextCursor.value === null))
      return null

    loading.value = true
    try {
      const response = await useRequestFetch()<{ photos: Photo[], next_cursor: number | null }>(`/api/albums/${albumId.value}/photos`, {
        query: nextCursor.value === null ? undefined : { cursor: nextCursor.value },
      })
      photos.value = [...photos.value, ...response.photos]
      nextCursor.value = response.next_cursor
      loaded.value = true
      return photos.value
    }
    finally {
      loading.value = false
    }
  }

  // Search scoped to this Album's own Photos (issue #190), filename only
  // — the Album's title is already the fixed context here, so it isn't
  // also matched against (unlike usePhotoLibrary#searchPhotos' library-
  // wide search). A single capped batch of matches, not part of the
  // paginated `photos` state above.
  async function searchPhotos(keyword: string) {
    const response = await $fetch<{ photos: Photo[] }>('/api/photos/search', { query: { q: keyword, album_id: albumId.value } })
    return response.photos
  }

  watch(albumId, async () => {
    reset()
    await fetchNextPage()
  })

  // Inserts a newly-added Photo at the front (issue #170's add-photo
  // endpoint returns just the Photo, newest-assigned-first ordering means
  // it always belongs at the very start of whatever's already loaded) —
  // a no-op if it's already present, so a picker's optimistic update and
  // a later page fetch that happens to include it don't duplicate it.
  function prependPhoto(photo: Photo) {
    if (photos.value.some(existing => existing.id === photo.id))
      return
    photos.value = [photo, ...photos.value]
  }

  function removePhoto(photoId: number) {
    photos.value = photos.value.filter(photo => photo.id !== photoId)
  }

  function updatePhoto(updated: Photo) {
    photos.value = photos.value.map(photo => photo.id === updated.id ? updated : photo)
  }

  return {
    photos,
    hasMore,
    loaded,
    loading,
    fetchNextPage,
    searchPhotos,
    prependPhoto,
    removePhoto,
    updatePhoto,
  }
}
