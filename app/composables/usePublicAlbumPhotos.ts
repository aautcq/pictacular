import type { PublicAlbumPhoto } from './useAlbums'

// Public Share Link counterpart of useAlbumPhotos (issue #170): the same
// paginated shape (and the same fixed-key `useState`, so the SSR-rendered
// first page survives client hydration), but against the unauthenticated
// GET /api/albums/public/:token/photos endpoint and PublicAlbumPhoto's
// narrower shape (no `liked`), for the Public Share Link page.
export function usePublicAlbumPhotos(token: Ref<string>) {
  const photos = useState<PublicAlbumPhoto[]>('public-album-photos', () => [])
  const nextCursor = useState<number | null>('public-album-photos-cursor', () => null)
  const loaded = useState<boolean>('public-album-photos-loaded', () => false)
  const loading = useState<boolean>('public-album-photos-loading', () => false)

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
      const requestFetch = import.meta.server ? useRequestFetch() : $fetch
      const response = await requestFetch<{ photos: PublicAlbumPhoto[], next_cursor: number | null }>(`/api/albums/public/${token.value}/photos`, {
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

  // `token` is reactive so navigating from one Share Link straight to
  // another (Vue Router reuses the `[token].vue` instance rather than
  // remounting it) resets and refetches instead of leaving the previous
  // Album's Photos on screen.
  watch(token, async () => {
    reset()
    await fetchNextPage()
  })

  return {
    photos,
    hasMore,
    loaded,
    loading,
    fetchNextPage,
  }
}
